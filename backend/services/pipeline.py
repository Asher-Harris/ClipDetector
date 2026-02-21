import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from services.downloader import TwitchDownloader
from services.twitch import TwitchClient, VodStorage, parse_duration_to_seconds
from services.vertical import convert_to_vertical, detect_layout

log = logging.getLogger(__name__)

CLIPS_DIR = Path(__file__).parent.parent.parent / "data" / "clips"


async def _is_valid_video(path: Path) -> bool:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    stdout, _ = await proc.communicate()
    return proc.returncode == 0 and b"video" in stdout


@dataclass
class PipelineResult:
    started_at: str
    completed_at: str | None = None
    vods_processed: int = 0
    clips_downloaded: int = 0
    clips_converted: int = 0
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "vods_processed": self.vods_processed,
            "clips_downloaded": self.clips_downloaded,
            "clips_converted": self.clips_converted,
            "errors": self.errors,
        }


def _parse_vod_end_time(vod: dict) -> datetime:
    created_at = datetime.fromisoformat(vod["created_at"].replace("Z", "+00:00"))
    duration_s = parse_duration_to_seconds(vod.get("duration", "")) or 0
    return created_at + timedelta(seconds=duration_s)


async def _process_vod(
    vod: dict,
    storage: VodStorage,
    twitch_client: TwitchClient,
    downloader: TwitchDownloader,
    config: dict,
    anthropic_key: str,
    result: PipelineResult,
) -> None:
    vod_id = vod["id"]
    vod_title = vod.get("title", vod_id)
    storage.update_vod(vod_id, {"automation_state": "processing"})
    log.info("Processing VOD: %s", vod_title)

    try:
        automation_cfg = config.get("automation", {})
        top_n = automation_cfg.get("top_clips_per_vod", 10)
        delay_hours = automation_cfg.get("clip_delay_hours", 3)

        vod_end = _parse_vod_end_time(vod)
        if datetime.now(timezone.utc) < vod_end + timedelta(hours=delay_hours):
            log.info("VOD too recent, skipping: %s", vod_title)
            storage.update_vod(vod_id, {"automation_state": "pending"})
            return

        channel_login = vod.get("channel_login", "")
        broadcaster_id = vod.get("channel_id")
        if not broadcaster_id:
            data = storage.load()
            broadcaster_id = data.get("channels", {}).get(channel_login, {}).get("id")

        if not broadcaster_id:
            storage.update_vod(vod_id, {
                "automation_state": "error",
                "automation_error": "No broadcaster_id found",
            })
            result.errors.append(f"VOD {vod_id}: no broadcaster_id")
            return

        started_at = vod["created_at"]
        ended_at = (vod_end + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")

        clips = await twitch_client.get_clips(broadcaster_id, started_at, ended_at)
        top_clips = sorted(clips, key=lambda c: c.view_count, reverse=True)[:top_n]
        log.info("Found %d clips for VOD %s, processing top %d", len(clips), vod_title, len(top_clips))

        CLIPS_DIR.mkdir(parents=True, exist_ok=True)
        vertical_files = []

        for clip in top_clips:
            clip_path = CLIPS_DIR / f"{clip.id}.mp4"

            if not clip_path.exists():
                log.info("Downloading clip: %s (%d views)", clip.title, clip.view_count)
                success = await downloader.download_clip(clip.id, clip_path, on_progress=None)
                if not success:
                    log.error("Download failed: %s", clip.id)
                    result.errors.append(f"Clip {clip.id}: download failed")
                    continue
                result.clips_downloaded += 1

            v_path = CLIPS_DIR / f"{clip.id}_vertical.mp4"
            if v_path.exists():
                if await _is_valid_video(v_path):
                    log.info("Vertical already exists, skipping: %s", clip.id)
                    vertical_files.append(v_path.name)
                    continue
                log.warning("Existing vertical is invalid, re-encoding: %s", clip.id)
                v_path.unlink()

            log.info("Detecting layout for clip: %s", clip.id)
            layout = await detect_layout(str(clip_path), anthropic_key)
            if layout is None:
                log.info("Layout detection returned None, skipping clip: %s", clip.id)
                continue
            log.info("Converting to vertical: %s (layout=%s)", clip.id, layout.layout_type)
            converted = await convert_to_vertical(str(clip_path), str(v_path), layout)
            if converted:
                log.info("Converted: %s", v_path.name)
                vertical_files.append(v_path.name)
                result.clips_converted += 1
            else:
                log.error("Conversion failed: %s", clip.id)
                result.errors.append(f"Clip {clip.id}: conversion failed")

        storage.update_vod(vod_id, {
            "automation_state": "done",
            "processed_at": datetime.now(timezone.utc).isoformat(),
            "vertical_clips": vertical_files,
            "delivered_clips": vod.get("delivered_clips", []),
        })
        log.info("VOD done: %s — %d vertical clips", vod_title, len(vertical_files))
        result.vods_processed += 1

    except Exception as exc:
        log.error("VOD %s failed: %s", vod_title, exc)
        storage.update_vod(vod_id, {
            "automation_state": "error",
            "automation_error": str(exc),
        })
        result.errors.append(f"VOD {vod_id}: {exc}")


async def run_automation_pipeline(
    config: dict,
    storage: VodStorage,
    twitch_client: TwitchClient,
    downloader: TwitchDownloader,
    anthropic_key: str,
) -> PipelineResult:
    result = PipelineResult(started_at=datetime.now(timezone.utc).isoformat())
    log.info("Pipeline started")

    channels = config.get("twitch", {}).get("channels", [])
    for channel_login in channels:
        try:
            user = await twitch_client.get_user(channel_login)
            if not user:
                log.warning("Channel not found: %s", channel_login)
                continue
            vods = await twitch_client.get_channel_vods(user.id, limit=5)
            log.info("Fetched %d VODs for %s", len(vods), channel_login)
            storage.merge_vods(
                channel_login=user.login,
                channel_info={
                    "id": user.id,
                    "display_name": user.display_name,
                    "profile_image_url": user.profile_image_url,
                },
                new_vods=vods,
            )
        except Exception as exc:
            log.error("Channel %s: %s", channel_login, exc)
            result.errors.append(f"Channel {channel_login}: {exc}")

    unprocessed = storage.get_unprocessed_vods()
    log.info("Found %d unprocessed VODs", len(unprocessed))

    await asyncio.gather(
        *[
            _process_vod(vod, storage, twitch_client, downloader, config, anthropic_key, result)
            for vod in unprocessed
        ],
        return_exceptions=True,
    )

    log.info(
        "Pipeline complete — VODs: %d, downloaded: %d, converted: %d, errors: %d",
        result.vods_processed,
        result.clips_downloaded,
        result.clips_converted,
        len(result.errors),
    )
    result.completed_at = datetime.now(timezone.utc).isoformat()
    return result
