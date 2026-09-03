import asyncio
import json
import logging
import os
import re
import subprocess
from asyncio import Semaphore
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from analyzers.audio import AnalysisConfig as AudioConfig
from analyzers.chat import ChatConfig
from analyzers.fusion import analyze_full, FusionConfig
from analyzers.speech import SpeechConfig
from analyzers.clips import analyze_clips
from services.twitch import TwitchClient, VodStorage, parse_duration_to_seconds
from services.downloader import TwitchDownloader
from services.pipeline import run_automation_pipeline
from services.scheduler import get_job_info, setup_scheduler, stop_scheduler

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s [%(name)s] %(message)s",
)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

_pipeline_running = False
_pipeline_results: list[dict] = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = load_config()
    if config.get("automation", {}).get("enabled", True):
        interval = config.get("automation", {}).get("check_interval_hours", 2)

        async def pipeline_task():
            global _pipeline_running, _pipeline_results
            if _pipeline_running:
                return
            _pipeline_running = True
            try:
                twitch_cfg = get_twitch_config()
                if not twitch_cfg:
                    return
                client = TwitchClient(twitch_cfg["client_id"], twitch_cfg["client_secret"])
                storage = VodStorage(VODS_STORAGE_PATH)
                downloader = TwitchDownloader(twitch_cfg["cli_path"])
                result = await run_automation_pipeline(
                    load_config(), storage, client, downloader, ANTHROPIC_API_KEY
                )
                _pipeline_results.insert(0, result.to_dict())
                del _pipeline_results[10:]
            finally:
                _pipeline_running = False

        setup_scheduler(pipeline_task, interval)

    yield
    stop_scheduler()


app = FastAPI(title="ClipDetector API", version="0.1.0", lifespan=lifespan)

# ============ Download Management ============
# {vod_id: {"downloader": ..., "video_path": ..., "chat_path": ..., "stage": ..., "video_percent": ..., "chat_percent": ..., "message": ...}}
active_downloads: dict[str, dict] = {}
download_semaphore = Semaphore(1)

# ============ Config ============

CONFIG_PATH = Path(__file__).parent.parent / "config.json"

def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}
    return {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000",
        ).split(",")
        if origin.strip()
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Base path for data files
DATA_DIR = Path(__file__).parent.parent / "data"
PROFILES_DIR = DATA_DIR / "profiles"


# ============ Profile Models ============

class ProfileConfig(BaseModel):
    id: str = Field(..., pattern=r"^[a-z0-9-]+$", min_length=1, max_length=50)
    name: str = Field(..., min_length=1, max_length=100)
    is_default: bool = False
    created_at: str
    updated_at: str
    audio_weight: float = Field(default=1.0, ge=0.0, le=5.0)
    chat_weight: float = Field(default=1.5, ge=0.0, le=5.0)
    audio_threshold_multiplier: float = Field(default=2.5, ge=1.0, le=10.0)
    chat_threshold: float = Field(default=3.0, ge=1.0, le=10.0)
    audio_intensity_cap: float = Field(default=2.5, ge=1.0, le=10.0)
    synergy_bonus: float = Field(default=0.75, ge=0.0, le=2.0)
    min_score: float = Field(default=3.0, ge=0.0, le=50.0)
    speech_keyword_weight: float = Field(default=1.5, ge=0.0, le=5.0)
    speech_rate_weight: float = Field(default=1.0, ge=0.0, le=5.0)
    clip_popular_weight: float = Field(default=3.5, ge=0.0, le=5.0)
    clip_density_weight: float = Field(default=2.5, ge=0.0, le=5.0)


class ProfileCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    audio_weight: float = Field(default=1.0, ge=0.0, le=5.0)
    chat_weight: float = Field(default=1.5, ge=0.0, le=5.0)
    audio_threshold_multiplier: float = Field(default=2.5, ge=1.0, le=10.0)
    chat_threshold: float = Field(default=3.0, ge=1.0, le=10.0)
    audio_intensity_cap: float = Field(default=2.5, ge=1.0, le=10.0)
    synergy_bonus: float = Field(default=0.75, ge=0.0, le=2.0)
    min_score: float = Field(default=3.0, ge=0.0, le=50.0)
    speech_keyword_weight: float = Field(default=1.5, ge=0.0, le=5.0)
    speech_rate_weight: float = Field(default=1.0, ge=0.0, le=5.0)
    clip_popular_weight: float = Field(default=3.5, ge=0.0, le=5.0)
    clip_density_weight: float = Field(default=2.5, ge=0.0, le=5.0)


class ProfileUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    audio_weight: float | None = Field(default=None, ge=0.0, le=5.0)
    chat_weight: float | None = Field(default=None, ge=0.0, le=5.0)
    audio_threshold_multiplier: float | None = Field(default=None, ge=1.0, le=10.0)
    chat_threshold: float | None = Field(default=None, ge=1.0, le=10.0)
    audio_intensity_cap: float | None = Field(default=None, ge=1.0, le=10.0)
    synergy_bonus: float | None = Field(default=None, ge=0.0, le=2.0)
    min_score: float | None = Field(default=None, ge=0.0, le=50.0)
    speech_keyword_weight: float | None = Field(default=None, ge=0.0, le=5.0)
    speech_rate_weight: float | None = Field(default=None, ge=0.0, le=5.0)
    clip_popular_weight: float | None = Field(default=None, ge=0.0, le=5.0)
    clip_density_weight: float | None = Field(default=None, ge=0.0, le=5.0)


def slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug[:50].strip("-")


def ensure_profiles_dir() -> None:
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    default_path = PROFILES_DIR / "default.json"
    if not default_path.exists():
        now = datetime.now(timezone.utc).isoformat()
        default_profile = ProfileConfig(
            id="default",
            name="Default",
            is_default=True,
            created_at=now,
            updated_at=now,
        )
        default_path.write_text(default_profile.model_dump_json(indent=2))


def get_content_type(file_path: Path) -> str:
    """Get MIME type based on file extension."""
    ext = file_path.suffix.lower()
    content_types = {
        ".mp4": "video/mp4",
        ".mkv": "video/x-matroska",
        ".webm": "video/webm",
        ".mov": "video/quicktime",
    }
    return content_types.get(ext, "application/octet-stream")


def parse_byte_range(range_header: str, file_size: int) -> tuple[int, int]:
    """Parse a single HTTP byte range and return inclusive start/end offsets."""
    unit, separator, value = range_header.partition("=")
    if unit.strip().lower() != "bytes" or not separator or "," in value:
        raise ValueError("Unsupported range")

    start_text, dash, end_text = value.strip().partition("-")
    if not dash or file_size <= 0:
        raise ValueError("Invalid range")

    try:
        if start_text:
            start = int(start_text)
            end = int(end_text) if end_text else file_size - 1
            if start < 0 or start >= file_size or end < start:
                raise ValueError("Unsatisfiable range")
            return start, min(end, file_size - 1)

        suffix_length = int(end_text)
        if suffix_length <= 0:
            raise ValueError("Invalid suffix range")
        return max(0, file_size - suffix_length), file_size - 1
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid range") from exc


@app.get("/data/vods/{filename:path}")
async def stream_video(filename: str, request: Request):
    """Stream video with Range request support for seeking."""
    video_path = DATA_DIR / "vods" / filename

    # Security check
    try:
        video_path = video_path.resolve()
        vods_dir_resolved = (DATA_DIR / "vods").resolve()
        if not video_path.is_relative_to(vods_dir_resolved):
            raise HTTPException(status_code=400, detail="Invalid file path")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file path")

    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    file_size = video_path.stat().st_size
    content_type = get_content_type(video_path)

    # Parse Range header
    range_header = request.headers.get("range")

    if range_header:
        try:
            start, end = parse_byte_range(range_header, file_size)
        except ValueError:
            raise HTTPException(
                status_code=416,
                detail="Requested range is not satisfiable",
                headers={"Content-Range": f"bytes */{file_size}"},
            )
        content_length = end - start + 1

        def iter_file():
            with open(video_path, "rb") as f:
                f.seek(start)
                remaining = content_length
                chunk_size = 1024 * 1024  # 1MB chunks
                while remaining > 0:
                    read_size = min(chunk_size, remaining)
                    data = f.read(read_size)
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        return StreamingResponse(
            iter_file(),
            status_code=206,
            media_type=content_type,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(content_length),
            },
        )
    else:
        # No Range header - serve full file
        def iter_full_file():
            with open(video_path, "rb") as f:
                chunk_size = 1024 * 1024  # 1MB chunks
                while chunk := f.read(chunk_size):
                    yield chunk

        return StreamingResponse(
            iter_full_file(),
            media_type=content_type,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
            },
        )


@app.get("/data/clips/{filename:path}")
async def stream_clip(filename: str, request: Request):
    """Stream clip with Range request support."""
    clip_path = DATA_DIR / "clips" / filename

    try:
        clip_path = clip_path.resolve()
        clips_dir_resolved = (DATA_DIR / "clips").resolve()
        if not clip_path.is_relative_to(clips_dir_resolved):
            raise HTTPException(status_code=400, detail="Invalid file path")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file path")

    if not clip_path.exists():
        raise HTTPException(status_code=404, detail="Clip not found")

    file_size = clip_path.stat().st_size
    content_type = get_content_type(clip_path)
    range_header = request.headers.get("range")

    if range_header:
        try:
            start, end = parse_byte_range(range_header, file_size)
        except ValueError:
            raise HTTPException(
                status_code=416,
                detail="Requested range is not satisfiable",
                headers={"Content-Range": f"bytes */{file_size}"},
            )
        content_length = end - start + 1

        def iter_clip():
            with open(clip_path, "rb") as f:
                f.seek(start)
                remaining = content_length
                chunk_size = 1024 * 1024
                while remaining > 0:
                    data = f.read(min(chunk_size, remaining))
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        return StreamingResponse(
            iter_clip(),
            status_code=206,
            media_type=content_type,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(content_length),
            },
        )
    else:
        def iter_full_clip():
            with open(clip_path, "rb") as f:
                chunk_size = 1024 * 1024
                while chunk := f.read(chunk_size):
                    yield chunk

        return StreamingResponse(
            iter_full_clip(),
            media_type=content_type,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
            },
        )


# Serve other static files (non-video)
if DATA_DIR.exists():
    app.mount("/data", StaticFiles(directory=DATA_DIR), name="data")


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "clipdetector-api"}


# ============ Profile Endpoints ============

@app.get("/api/profiles", response_model=list[ProfileConfig])
async def list_profiles():
    ensure_profiles_dir()
    profiles = []
    for file in PROFILES_DIR.glob("*.json"):
        with open(file) as f:
            profiles.append(ProfileConfig(**json.load(f)))
    return sorted(profiles, key=lambda p: (not p.is_default, p.name))


@app.get("/api/profiles/{profile_id}", response_model=ProfileConfig)
async def get_profile(profile_id: str):
    ensure_profiles_dir()
    profile_path = PROFILES_DIR / f"{profile_id}.json"
    if not profile_path.exists():
        raise HTTPException(status_code=404, detail="Profile not found")
    with open(profile_path) as f:
        return ProfileConfig(**json.load(f))


@app.post("/api/profiles", response_model=ProfileConfig)
async def create_profile(request: ProfileCreateRequest):
    ensure_profiles_dir()
    profile_id = slugify(request.name)
    if not profile_id:
        profile_id = "profile"

    base_id = profile_id
    counter = 1
    while (PROFILES_DIR / f"{profile_id}.json").exists():
        profile_id = f"{base_id}-{counter}"
        counter += 1

    now = datetime.now(timezone.utc).isoformat()
    profile = ProfileConfig(
        id=profile_id,
        name=request.name,
        is_default=False,
        created_at=now,
        updated_at=now,
        audio_weight=request.audio_weight,
        chat_weight=request.chat_weight,
        audio_threshold_multiplier=request.audio_threshold_multiplier,
        chat_threshold=request.chat_threshold,
        audio_intensity_cap=request.audio_intensity_cap,
        synergy_bonus=request.synergy_bonus,
        min_score=request.min_score,
        speech_keyword_weight=request.speech_keyword_weight,
        speech_rate_weight=request.speech_rate_weight,
        clip_popular_weight=request.clip_popular_weight,
        clip_density_weight=request.clip_density_weight,
    )

    profile_path = PROFILES_DIR / f"{profile_id}.json"
    profile_path.write_text(profile.model_dump_json(indent=2))
    return profile


@app.put("/api/profiles/{profile_id}", response_model=ProfileConfig)
async def update_profile(profile_id: str, request: ProfileUpdateRequest):
    ensure_profiles_dir()
    profile_path = PROFILES_DIR / f"{profile_id}.json"
    if not profile_path.exists():
        raise HTTPException(status_code=404, detail="Profile not found")

    with open(profile_path) as f:
        existing = ProfileConfig(**json.load(f))

    update_data = request.model_dump(exclude_none=True)
    updated_dict = existing.model_dump()
    updated_dict.update(update_data)
    updated_dict["updated_at"] = datetime.now(timezone.utc).isoformat()
    updated = ProfileConfig(**updated_dict)

    profile_path.write_text(updated.model_dump_json(indent=2))
    return updated


@app.delete("/api/profiles/{profile_id}")
async def delete_profile(profile_id: str):
    ensure_profiles_dir()
    profile_path = PROFILES_DIR / f"{profile_id}.json"
    if not profile_path.exists():
        raise HTTPException(status_code=404, detail="Profile not found")

    with open(profile_path) as f:
        profile = ProfileConfig(**json.load(f))

    if profile.is_default:
        raise HTTPException(status_code=400, detail="Cannot delete default profile")

    profile_path.unlink()
    return {"message": "Profile deleted"}


class ClipCandidateResult(BaseModel):
    timestamp: float
    score: float
    signals: list[str]
    clip_start: float
    clip_end: float


class FullAnalysisResponse(BaseModel):
    video_path: str
    chat_path: str
    candidates: list[ClipCandidateResult]
    total_candidates: int
    config: dict


def resolve_safe_path(relative_path: str, data_dir: Path) -> Path:
    """Resolve a relative path and verify it's within the data directory."""
    full_path = data_dir / relative_path
    try:
        full_path = full_path.resolve()
        data_dir_resolved = data_dir.resolve()
        if not full_path.is_relative_to(data_dir_resolved):
            raise ValueError("Path traversal detected")
    except Exception:
        raise ValueError("Invalid path")
    return full_path


class ClipExportRequest(BaseModel):
    vod_path: str = Field(..., description="Path to VOD file relative to /data folder")
    start_time: float = Field(..., ge=0, description="Start timestamp in seconds")
    end_time: float = Field(..., gt=0, description="End timestamp in seconds")
    output_filename: str = Field(
        ..., min_length=1, max_length=200, description="Output filename (without path)"
    )


class ClipExportResponse(BaseModel):
    success: bool
    output_path: str
    duration: float
    file_size: int


@app.post("/api/clips/export", response_model=ClipExportResponse)
async def export_clip(request: ClipExportRequest):
    """Export a clip segment from a VOD using FFmpeg.

    Uses stream copy (-c copy) for fast extraction.
    """
    # Validate VOD path
    try:
        vod_path = resolve_safe_path(request.vod_path, DATA_DIR)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid VOD path")

    if not vod_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"VOD file not found: {request.vod_path}"
        )

    # Validate timestamps
    if request.end_time <= request.start_time:
        raise HTTPException(
            status_code=400,
            detail="End time must be greater than start time"
        )

    # Ensure clips directory exists
    clips_dir = DATA_DIR / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)

    # Sanitize output filename
    safe_filename = "".join(
        c for c in request.output_filename
        if c.isalnum() or c in "._-"
    )
    if not safe_filename.strip("._-"):
        raise HTTPException(status_code=400, detail="Invalid output filename")
    if not safe_filename.endswith(".mp4"):
        safe_filename += ".mp4"

    output_path = clips_dir / safe_filename

    # Build FFmpeg command
    # Use input-seeking (-ss before -i) + stream copy for fast extraction
    duration = request.end_time - request.start_time
    cmd = [
        "ffmpeg",
        "-y",  # Overwrite output
        "-ss", str(request.start_time),  # Input seeking (fast)
        "-i", str(vod_path),
        "-t", str(duration),
        "-c", "copy",  # Stream copy (no re-encoding)
        "-avoid_negative_ts", "make_zero",
        str(output_path),
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60,  # 1 minute timeout (stream copy is fast)
        )

        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"FFmpeg failed: {result.stderr[:500]}"
            )

    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=500,
            detail="Export timed out - clip may be too long"
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=500,
            detail="FFmpeg not found - please install FFmpeg"
        )

    if not output_path.exists():
        raise HTTPException(
            status_code=500,
            detail="Export failed - output file not created"
        )

    file_size = output_path.stat().st_size

    return ClipExportResponse(
        success=True,
        output_path=f"clips/{safe_filename}",
        duration=duration,
        file_size=file_size,
    )


# ============ Local Clips Endpoints ============

class LocalClip(BaseModel):
    filename: str
    file_size: int
    created_at: str
    duration: float


def get_video_duration(file_path: Path) -> float:
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "quiet", "-print_format", "json",
                "-show_format", str(file_path),
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            info = json.loads(result.stdout)
            return float(info.get("format", {}).get("duration", 0))
    except (subprocess.TimeoutExpired, json.JSONDecodeError, ValueError):
        pass
    return 0


VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm", ".mov"}


@app.get("/api/clips", response_model=list[LocalClip])
async def list_local_clips():
    clips_dir = DATA_DIR / "clips"
    if not clips_dir.exists():
        return []

    clips = []
    for f in clips_dir.iterdir():
        if not f.is_file() or f.suffix.lower() not in VIDEO_EXTENSIONS:
            continue
        stat = f.stat()
        clips.append(LocalClip(
            filename=f.name,
            file_size=stat.st_size,
            created_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            duration=get_video_duration(f),
        ))

    clips.sort(key=lambda c: c.created_at, reverse=True)
    return clips


@app.delete("/api/clips/{filename}")
async def delete_local_clip(filename: str):
    clips_dir = DATA_DIR / "clips"
    file_path = clips_dir / filename
    try:
        resolved = file_path.resolve()
        clips_resolved = clips_dir.resolve()
        if not resolved.is_relative_to(clips_resolved):
            raise HTTPException(status_code=400, detail="Invalid filename")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid filename")

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Clip not found")

    file_path.unlink()
    return {"message": "Clip deleted"}


# ============ Twitch VOD Endpoints ============

TWITCH_DIR = DATA_DIR / "twitch"
VODS_STORAGE_PATH = TWITCH_DIR / "vods.json"


def get_twitch_config() -> dict | None:
    client_id = os.getenv("TWITCH_CLIENT_ID")
    client_secret = os.getenv("TWITCH_CLIENT_SECRET")
    if not client_id or not client_secret:
        return None
    config = load_config()
    twitch_config = config.get("twitch", {})
    return {
        "client_id": client_id,
        "client_secret": client_secret,
        "channels": twitch_config.get("channels", []),
        "cli_path": twitch_config.get("cli_path", "TwitchDownloaderCLI"),
    }


def check_vod_downloaded(vod: dict, vods_dir: Path, chats_dir: Path) -> bool:
    video_filename = vod.get("video_filename")
    chat_filename = vod.get("chat_filename")
    if not video_filename or not chat_filename:
        return False
    return (vods_dir / video_filename).exists() and (chats_dir / chat_filename).exists()


@app.get("/api/twitch/vods")
async def list_twitch_vods():
    storage = VodStorage(VODS_STORAGE_PATH)
    data = storage.load()
    channels_data = data.get("channels", {})

    channels = [
        {
            "login": login,
            "display_name": info.get("display_name", login),
            "profile_image_url": info.get("profile_image_url"),
        }
        for login, info in channels_data.items()
    ]

    vods_dir = DATA_DIR / "vods"
    chats_dir = DATA_DIR / "chats"
    vods = data.get("vods", [])
    for vod in vods:
        vod["downloaded"] = check_vod_downloaded(vod, vods_dir, chats_dir)
        channel_info = channels_data.get(vod.get("channel_login"), {})
        vod["channel_display_name"] = channel_info.get("display_name")
        vod["channel_profile_image_url"] = channel_info.get("profile_image_url")

    return {
        "channels": channels,
        "vods": vods,
    }


@app.post("/api/twitch/vods/refresh")
async def refresh_twitch_vods():
    twitch_config = get_twitch_config()
    if not twitch_config:
        raise HTTPException(
            status_code=400,
            detail="Twitch credentials not configured in config.json"
        )

    client = TwitchClient(
        client_id=twitch_config["client_id"],
        client_secret=twitch_config["client_secret"],
    )
    storage = VodStorage(VODS_STORAGE_PATH)

    channels_to_fetch = twitch_config.get("channels", [])
    errors = []

    for channel_login in channels_to_fetch:
        try:
            user = await client.get_user(channel_login)
            if not user:
                errors.append({"channel": channel_login, "error": "Channel not found"})
                continue

            vods = await client.get_channel_vods(user.id, limit=20)
            storage.merge_vods(
                channel_login=user.login,
                channel_info={
                    "id": user.id,
                    "display_name": user.display_name,
                    "profile_image_url": user.profile_image_url,
                },
                new_vods=vods,
            )
        except Exception as e:
            errors.append({"channel": channel_login, "error": str(e)})
            continue

    data = storage.load()
    channels_data = data.get("channels", {})
    channels = [
        {
            "login": login,
            "display_name": info.get("display_name", login),
            "profile_image_url": info.get("profile_image_url"),
        }
        for login, info in channels_data.items()
    ]

    vods_dir = DATA_DIR / "vods"
    chats_dir = DATA_DIR / "chats"
    vods = data.get("vods", [])
    for vod in vods:
        vod["downloaded"] = check_vod_downloaded(vod, vods_dir, chats_dir)
        channel_info = channels_data.get(vod.get("channel_login"), {})
        vod["channel_display_name"] = channel_info.get("display_name")
        vod["channel_profile_image_url"] = channel_info.get("profile_image_url")

    return {
        "channels": channels,
        "vods": vods,
        "errors": errors,
    }


def generate_unique_filename(directory: Path, channel_login: str, created_at: str, extension: str) -> str:
    date_str = created_at[:10]
    base_name = f"{channel_login}_{date_str}"

    if not (directory / f"{base_name}{extension}").exists():
        return f"{base_name}{extension}"

    counter = 2
    while (directory / f"{base_name}_{counter}{extension}").exists():
        counter += 1

    return f"{base_name}_{counter}{extension}"


@app.post("/api/twitch/vods/{vod_id}/download")
async def download_twitch_vod(vod_id: str):
    if vod_id in active_downloads:
        raise HTTPException(status_code=409, detail="Download already in progress for this VOD")

    twitch_config = get_twitch_config()
    cli_path = twitch_config.get("cli_path", "TwitchDownloaderCLI") if twitch_config else "TwitchDownloaderCLI"

    downloader = TwitchDownloader(cli_path)
    if not downloader.is_available():
        raise HTTPException(
            status_code=503,
            detail="TwitchDownloaderCLI not found or not executable"
        )

    storage = VodStorage(VODS_STORAGE_PATH)
    vod = storage.get_vod(vod_id)
    if not vod:
        raise HTTPException(status_code=404, detail="VOD not found in storage")

    vods_dir = DATA_DIR / "vods"
    chats_dir = DATA_DIR / "chats"
    vods_dir.mkdir(parents=True, exist_ok=True)
    chats_dir.mkdir(parents=True, exist_ok=True)

    if check_vod_downloaded(vod, vods_dir, chats_dir):
        raise HTTPException(status_code=400, detail="VOD already downloaded")

    channel_login = vod.get("channel_login", "unknown")
    created_at = vod.get("created_at", "")

    video_filename = generate_unique_filename(vods_dir, channel_login, created_at, ".mp4")
    chat_filename = generate_unique_filename(chats_dir, channel_login, created_at, ".json")

    video_path = vods_dir / video_filename
    chat_path = chats_dir / chat_filename

    import queue as sync_queue

    progress_queue: sync_queue.Queue = sync_queue.Queue()
    cancelled = {"value": False}

    async def run_downloads():
        active_downloads[vod_id] = {
            "downloader": downloader,
            "video_path": video_path,
            "chat_path": chat_path,
            "stage": "queued",
            "video_percent": 0,
            "chat_percent": 0,
            "message": "Waiting in queue...",
        }
        try:
            progress_queue.put({
                "stage": "queued",
                "percent": 0,
                "message": "Waiting in queue...",
            })

            async with download_semaphore:
                if cancelled["value"]:
                    progress_queue.put({"error": "Download cancelled"})
                    return

                def video_progress(percent: int):
                    if vod_id in active_downloads:
                        active_downloads[vod_id]["stage"] = "video"
                        active_downloads[vod_id]["video_percent"] = percent
                        active_downloads[vod_id]["message"] = f"Downloading video: {percent}%"
                    progress_queue.put({
                        "stage": "video",
                        "percent": percent,
                        "message": f"Downloading video: {percent}%",
                    })

                def chat_progress(percent: int):
                    if vod_id in active_downloads:
                        active_downloads[vod_id]["stage"] = "chat"
                        active_downloads[vod_id]["chat_percent"] = percent
                        active_downloads[vod_id]["message"] = f"Downloading chat: {percent}%"
                    progress_queue.put({
                        "stage": "chat",
                        "percent": percent,
                        "message": f"Downloading chat: {percent}%",
                    })

                video_progress(0)
                chat_progress(0)

                video_task = asyncio.create_task(
                    downloader.download_video(vod_id, video_path, video_progress)
                )
                chat_task = asyncio.create_task(
                    downloader.download_chat(vod_id, chat_path, chat_progress)
                )

                results = await asyncio.gather(video_task, chat_task, return_exceptions=True)

                if cancelled["value"]:
                    if video_path.exists():
                        video_path.unlink()
                    if chat_path.exists():
                        chat_path.unlink()
                    progress_queue.put({"error": "Download cancelled"})
                    return

                video_result, chat_result = results

                if isinstance(video_result, Exception):
                    progress_queue.put({"error": f"Video download failed: {video_result}"})
                    if video_path.exists():
                        video_path.unlink()
                    if chat_path.exists():
                        chat_path.unlink()
                    return

                if isinstance(chat_result, Exception):
                    progress_queue.put({"error": f"Chat download failed: {chat_result}"})
                    if video_path.exists():
                        video_path.unlink()
                    if chat_path.exists():
                        chat_path.unlink()
                    return

                if not video_result:
                    progress_queue.put({"error": "Video download failed"})
                    if video_path.exists():
                        video_path.unlink()
                    if chat_path.exists():
                        chat_path.unlink()
                    return

                if not chat_result:
                    progress_queue.put({"error": "Chat download failed"})
                    if video_path.exists():
                        video_path.unlink()
                    if chat_path.exists():
                        chat_path.unlink()
                    return

                storage.update_vod(vod_id, {
                    "downloaded": True,
                    "video_filename": video_filename,
                    "chat_filename": chat_filename,
                })

                progress_queue.put({"complete": True})
        finally:
            active_downloads.pop(vod_id, None)

    async def event_stream():
        task = asyncio.create_task(run_downloads())

        while True:
            try:
                item = progress_queue.get_nowait()
                if "error" in item:
                    yield f"event: error\ndata: {json.dumps({'error': item['error']})}\n\n"
                    break
                elif "complete" in item:
                    yield f"event: complete\ndata: {json.dumps({'success': True})}\n\n"
                    break
                else:
                    yield f"event: progress\ndata: {json.dumps(item)}\n\n"
            except sync_queue.Empty:
                if task.done():
                    break
                await asyncio.sleep(0.2)

        await task

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@app.post("/api/twitch/vods/{vod_id}/cancel")
async def cancel_twitch_vod_download(vod_id: str):
    if vod_id not in active_downloads:
        raise HTTPException(status_code=404, detail="No active download for this VOD")

    download_info = active_downloads[vod_id]
    download_info["downloader"].cancel()

    video_path = download_info.get("video_path")
    chat_path = download_info.get("chat_path")
    if video_path and video_path.exists():
        video_path.unlink()
    if chat_path and chat_path.exists():
        chat_path.unlink()

    active_downloads.pop(vod_id, None)
    return {"success": True, "message": "Download cancelled"}


@app.get("/api/twitch/downloads/active")
async def get_active_downloads():
    """Return status of all active/queued downloads."""
    return {
        "downloads": {
            vod_id: {
                "stage": info.get("stage", "queued"),
                "videoPercent": info.get("video_percent", 0),
                "chatPercent": info.get("chat_percent", 0),
                "message": info.get("message", ""),
            }
            for vod_id, info in active_downloads.items()
        }
    }


# ============ Twitch Clip Endpoints ============


class ClipDownloadRequest(BaseModel):
    channel_login: str


@app.get("/api/twitch/vods/{vod_id}/clips")
async def list_vod_clips(vod_id: str):
    twitch_config = get_twitch_config()
    if not twitch_config:
        raise HTTPException(status_code=400, detail="Twitch credentials not configured")

    storage = VodStorage(VODS_STORAGE_PATH)
    data = storage.load()
    channels = data.get("channels", {})

    vod = None
    for v in data.get("vods", []):
        if v["id"] == vod_id:
            vod = v
            break

    if not vod:
        raise HTTPException(status_code=404, detail="VOD not found")

    channel_login = vod.get("channel_login", "")
    channel_info = channels.get(channel_login, {})
    broadcaster_id = channel_info.get("id")
    if not broadcaster_id:
        raise HTTPException(status_code=400, detail="Broadcaster ID not found for this VOD's channel")

    created_at = vod.get("created_at", "")
    duration_seconds = parse_duration_to_seconds(vod.get("duration", "")) or 0

    if not created_at or not duration_seconds:
        raise HTTPException(status_code=400, detail="VOD missing created_at or duration")

    start_dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    end_dt = start_dt + timedelta(seconds=duration_seconds + 3600)
    started_at = created_at
    ended_at = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    client = TwitchClient(
        twitch_config["client_id"],
        twitch_config["client_secret"],
    )
    twitch_clips = await client.get_clips(broadcaster_id, started_at, ended_at)

    clips_dir = DATA_DIR / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)

    clips = []
    for c in sorted(twitch_clips, key=lambda x: x.view_count, reverse=True):
        filename = f"{channel_login}_{c.id}.mp4"
        downloaded = (clips_dir / filename).exists()
        clips.append({
            "id": c.id,
            "video_id": c.video_id,
            "vod_offset": c.vod_offset,
            "view_count": c.view_count,
            "duration": c.duration,
            "created_at": c.created_at,
            "title": c.title,
            "creator_name": c.creator_name,
            "thumbnail_url": c.thumbnail_url,
            "downloaded": downloaded,
            "filename": filename if downloaded else None,
        })

    return {
        "vod_id": vod_id,
        "clips": clips,
        "total": len(clips),
    }


@app.delete("/api/twitch/clips/{clip_id}")
async def delete_twitch_clip(clip_id: str):
    clips_dir = DATA_DIR / "clips"
    matching = list(clips_dir.glob(f"*_{clip_id}.mp4"))
    if not matching:
        raise HTTPException(status_code=404, detail="Clip file not found")
    for f in matching:
        f.unlink()
    return {"message": "Clip deleted"}


@app.post("/api/twitch/clips/{clip_id}/download")
async def download_twitch_clip(clip_id: str, request: ClipDownloadRequest):
    twitch_config = get_twitch_config()
    cli_path = twitch_config.get("cli_path", "TwitchDownloaderCLI") if twitch_config else "TwitchDownloaderCLI"

    downloader = TwitchDownloader(cli_path)
    if not downloader.is_available():
        raise HTTPException(
            status_code=503,
            detail="TwitchDownloaderCLI not found or not executable",
        )

    clips_dir = DATA_DIR / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{request.channel_login}_{clip_id}.mp4"
    output_path = clips_dir / filename

    if output_path.exists():
        return {
            "success": True,
            "filename": filename,
            "file_size": output_path.stat().st_size,
            "already_existed": True,
        }

    success = await downloader.download_clip(clip_id, output_path)
    if not success:
        if output_path.exists():
            output_path.unlink()
        raise HTTPException(status_code=500, detail="Clip download failed")

    return {
        "success": True,
        "filename": filename,
        "file_size": output_path.stat().st_size,
        "already_existed": False,
    }


# ============ VOD Endpoints with Full Metadata ============

@app.get("/api/vods/downloaded")
async def list_downloaded_vods():
    """List downloaded VODs with full metadata and paths."""
    storage = VodStorage(VODS_STORAGE_PATH)
    vods_dir = DATA_DIR / "vods"
    chats_dir = DATA_DIR / "chats"

    vods = storage.list_downloaded_vods_with_channel_info()
    for vod in vods:
        video_filename = vod.get("video_filename")
        chat_filename = vod.get("chat_filename")
        vod["downloaded"] = (
            video_filename and chat_filename and
            (vods_dir / video_filename).exists() and
            (chats_dir / chat_filename).exists()
        )
    return {"vods": vods}


@app.get("/api/vods/{vod_id}")
async def get_vod_detail(vod_id: str):
    """Get single VOD detail with paths."""
    storage = VodStorage(VODS_STORAGE_PATH)
    vod = storage.get_vod_with_paths(vod_id)
    if not vod:
        raise HTTPException(status_code=404, detail="VOD not found")

    vods_dir = DATA_DIR / "vods"
    chats_dir = DATA_DIR / "chats"
    video_filename = vod.get("video_filename")
    chat_filename = vod.get("chat_filename")
    vod["downloaded"] = (
        video_filename and chat_filename and
        (vods_dir / video_filename).exists() and
        (chats_dir / chat_filename).exists()
    )

    return vod


class VodAnalyzeRequest(BaseModel):
    overlap_window: float = Field(default=10.0, ge=1.0, le=60.0)
    clip_buffer: float = Field(default=30.0, ge=5.0, le=120.0)
    audio_weight: float | None = Field(default=None, ge=0.0, le=5.0)
    chat_weight: float | None = Field(default=None, ge=0.0, le=5.0)
    audio_threshold_multiplier: float | None = Field(default=None, ge=1.0, le=10.0)
    chat_threshold: float | None = Field(default=None, ge=1.0, le=10.0)
    audio_intensity_cap: float | None = Field(default=None, ge=1.0, le=10.0)
    synergy_bonus: float | None = Field(default=None, ge=0.0, le=2.0)
    min_score: float | None = Field(default=None, ge=0.0, le=50.0)
    include_speech: bool = Field(default=False)
    speech_model_size: str = Field(default="base")
    speech_language: str = Field(default="en")
    speech_keyword_weight: float | None = Field(default=None, ge=0.0, le=5.0)
    speech_rate_weight: float | None = Field(default=None, ge=0.0, le=5.0)
    include_clips: bool = Field(default=True)
    clip_popular_weight: float | None = Field(default=None, ge=0.0, le=5.0)
    clip_density_weight: float | None = Field(default=None, ge=0.0, le=5.0)


@app.post("/api/vods/{vod_id}/analyze")
async def analyze_vod_by_id(vod_id: str, request: VodAnalyzeRequest):
    """Analyze VOD by ID (resolves paths internally)."""
    storage = VodStorage(VODS_STORAGE_PATH)
    vod = storage.get_vod_with_paths(vod_id)
    if not vod:
        raise HTTPException(status_code=404, detail="VOD not found")

    video_path = vod.get("video_path")
    chat_path = vod.get("chat_path")

    if not video_path or not chat_path:
        raise HTTPException(status_code=400, detail="VOD not downloaded")

    try:
        video_full_path = resolve_safe_path(video_path, DATA_DIR)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid video path")

    try:
        chat_full_path = resolve_safe_path(chat_path, DATA_DIR)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid chat path")

    if not video_full_path.exists():
        raise HTTPException(status_code=404, detail=f"Video file not found: {video_path}")

    if not chat_full_path.exists():
        raise HTTPException(status_code=404, detail=f"Chat file not found: {chat_path}")

    audio_config = AudioConfig(
        threshold_multiplier=request.audio_threshold_multiplier if request.audio_threshold_multiplier is not None else 2.5,
    )

    chat_config = ChatConfig(
        threshold=request.chat_threshold if request.chat_threshold is not None else 3.0,
    )

    fusion_config = FusionConfig(
        overlap_window=request.overlap_window,
        clip_buffer=request.clip_buffer,
        audio_weight=request.audio_weight if request.audio_weight is not None else 1.0,
        chat_weight=request.chat_weight if request.chat_weight is not None else 1.5,
        audio_intensity_cap=request.audio_intensity_cap if request.audio_intensity_cap is not None else 2.5,
        synergy_bonus=request.synergy_bonus if request.synergy_bonus is not None else 0.75,
        min_score=request.min_score if request.min_score is not None else 3.0,
        speech_keyword_weight=request.speech_keyword_weight if request.speech_keyword_weight is not None else 1.5,
        speech_rate_weight=request.speech_rate_weight if request.speech_rate_weight is not None else 1.0,
        clip_popular_weight=request.clip_popular_weight if request.clip_popular_weight is not None else 3.5,
        clip_density_weight=request.clip_density_weight if request.clip_density_weight is not None else 2.5,
    )

    speech_config = None
    if request.include_speech:
        speech_config = SpeechConfig(
            model_size=request.speech_model_size,
            language=request.speech_language,
        )

    clips_moments = None
    if request.include_clips:
        try:
            twitch_config = get_twitch_config()
            channel_login = vod.get("channel_login")
            if twitch_config and channel_login:
                data = storage.load()
                channels = data.get("channels", {})
                channel_info = channels.get(channel_login, {})
                broadcaster_id = channel_info.get("id")
                if broadcaster_id:
                    created_at = vod.get("created_at", "")
                    duration_seconds = vod.get("duration_seconds") or 0
                    if created_at and duration_seconds:
                        started_at = created_at
                        start_dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                        end_dt = start_dt + timedelta(seconds=duration_seconds + 3600)
                        ended_at = end_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                        client = TwitchClient(
                            twitch_config["client_id"],
                            twitch_config["client_secret"],
                        )
                        twitch_clips = await client.get_clips(
                            broadcaster_id, started_at, ended_at
                        )
                        clips_as_dicts = [
                            {
                                "video_id": c.video_id,
                                "vod_offset": c.vod_offset,
                                "view_count": c.view_count,
                                "duration": c.duration,
                                "title": c.title,
                                "creator_name": c.creator_name,
                            }
                            for c in twitch_clips
                        ]

                        clips_moments = analyze_clips(clips_as_dicts, vod_id)
        except Exception:
            clips_moments = None

    try:
        candidates = analyze_full(
            video_full_path,
            chat_full_path,
            audio_config=audio_config,
            chat_config=chat_config,
            fusion_config=fusion_config,
            include_speech=request.include_speech,
            speech_config=speech_config,
            clips_moments=clips_moments,
        )
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid chat JSON file: {e}")
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return FullAnalysisResponse(
        video_path=video_path,
        chat_path=chat_path,
        candidates=[
            ClipCandidateResult(
                timestamp=c.timestamp,
                score=c.score,
                signals=c.signals,
                clip_start=c.clip_start,
                clip_end=c.clip_end,
            )
            for c in candidates
        ],
        total_candidates=len(candidates),
        config={
            "overlap_window": fusion_config.overlap_window,
            "clip_buffer": fusion_config.clip_buffer,
            "dedup_window": fusion_config.dedup_window,
            "audio_weight": fusion_config.audio_weight,
            "chat_weight": fusion_config.chat_weight,
            "audio_threshold_multiplier": audio_config.threshold_multiplier,
            "chat_threshold": chat_config.threshold,
            "audio_intensity_cap": fusion_config.audio_intensity_cap,
            "synergy_bonus": fusion_config.synergy_bonus,
            "min_score": fusion_config.min_score,
            "include_speech": request.include_speech,
            "speech_model_size": request.speech_model_size if request.include_speech else None,
            "speech_language": request.speech_language if request.include_speech else None,
            "speech_keyword_weight": fusion_config.speech_keyword_weight if request.include_speech else None,
            "speech_rate_weight": fusion_config.speech_rate_weight if request.include_speech else None,
            "include_clips": request.include_clips,
            "clip_popular_weight": fusion_config.clip_popular_weight if clips_moments else None,
            "clip_density_weight": fusion_config.clip_density_weight if clips_moments else None,
            "vod_id": vod_id,
            "vod_title": vod.get("title"),
            "channel_login": vod.get("channel_login"),
        }
    )


@app.delete("/api/twitch/vods/{vod_id}")
async def delete_twitch_vod(vod_id: str):
    storage = VodStorage(VODS_STORAGE_PATH)
    data = storage.load()
    vods = data.get("vods", [])

    vod = next((v for v in vods if v.get("id") == vod_id), None)
    if not vod:
        raise HTTPException(status_code=404, detail="VOD not found")

    vods_dir = DATA_DIR / "vods"
    chats_dir = DATA_DIR / "chats"

    video_filename = vod.get("video_filename")
    chat_filename = vod.get("chat_filename")

    if video_filename:
        video_path = vods_dir / video_filename
        if video_path.exists():
            video_path.unlink()

    if chat_filename:
        chat_path = chats_dir / chat_filename
        if chat_path.exists():
            chat_path.unlink()

    storage.update_vod(vod_id, {
        "video_filename": None,
        "chat_filename": None,
    })

    return {"success": True, "message": "VOD deleted"}


# ============ Automation Endpoints ============

@app.get("/api/automation/status")
async def automation_status():
    job_info = get_job_info()
    return {
        "next_run": job_info["next_run"],
        "is_running": _pipeline_running,
        "scheduler_running": job_info["running"],
        "recent_results": _pipeline_results[:5],
    }


@app.post("/api/automation/run")
async def automation_run():
    global _pipeline_running, _pipeline_results

    if _pipeline_running:
        return {"triggered": False, "message": "Pipeline already running"}

    async def _run():
        global _pipeline_running, _pipeline_results
        _pipeline_running = True
        try:
            twitch_cfg = get_twitch_config()
            if not twitch_cfg:
                return
            client = TwitchClient(twitch_cfg["client_id"], twitch_cfg["client_secret"])
            storage = VodStorage(VODS_STORAGE_PATH)
            downloader = TwitchDownloader(twitch_cfg["cli_path"])
            result = await run_automation_pipeline(
                load_config(), storage, client, downloader, ANTHROPIC_API_KEY
            )
            _pipeline_results.insert(0, result.to_dict())
            del _pipeline_results[10:]
        finally:
            _pipeline_running = False

    asyncio.create_task(_run())
    return {"triggered": True, "message": "Pipeline started"}
