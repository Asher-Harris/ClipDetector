import logging
import os
from pathlib import Path

import httpx

from services.twitch import VodStorage

log = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")


async def deliver_ready_clips(storage: VodStorage, clips_dir: Path) -> int:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return 0

    ready = storage.get_ready_clips()
    if not ready:
        log.info("No ready clips to deliver")
        return 0

    log.info("Delivering %d clips to Telegram", len(ready))
    delivered_count = 0

    async with httpx.AsyncClient(timeout=120) as client:
        for item in ready:
            filename = item["filename"]
            file_path = clips_dir / filename
            if not file_path.exists():
                log.warning("Clip file missing, skipping: %s", filename)
                continue

            channel = item["channel_login"]
            vod_title = item["vod_title"]
            caption = f"{channel} — {vod_title}"

            try:
                with open(file_path, "rb") as f:
                    resp = await client.post(
                        f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendVideo",
                        data={"chat_id": TELEGRAM_CHAT_ID, "caption": caption},
                        files={"video": (filename, f, "video/mp4")},
                    )

                if resp.status_code == 200 and resp.json().get("ok"):
                    log.info("Delivered to Telegram: %s", filename)
                    storage.mark_clip_delivered(filename)
                    delivered_count += 1
                else:
                    log.error("Telegram API error for %s: %s", filename, resp.text)
            except Exception as exc:
                log.error("Failed to deliver %s: %s", filename, exc)

    if delivered_count > 0:
        _cleanup_delivered(storage, clips_dir)

    return delivered_count


def _cleanup_delivered(storage: VodStorage, clips_dir: Path) -> None:
    data = storage.load()
    for vod in data.get("vods", []):
        for filename in vod.get("delivered_clips", []):
            for path in [clips_dir / filename, clips_dir / filename.replace("_vertical.mp4", ".mp4")]:
                if path.exists():
                    try:
                        path.unlink()
                        log.info("Cleaned up: %s", path.name)
                    except OSError as exc:
                        log.error("Cleanup failed for %s: %s", path.name, exc)
