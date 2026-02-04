import asyncio
import json
import os
import re
import subprocess
from asyncio import Semaphore
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from analyzers.audio import analyze_audio, AnalysisConfig as AudioConfig, AudioSpike
from analyzers.chat import analyze_chat, ChatConfig, ChatMoment
from analyzers.fusion import analyze_full, FusionConfig, ClipCandidate
from analyzers.speech import (
    analyze_speech,
    SpeechConfig,
    SpeechMoment,
    TranscriptSegment as SpeechTranscriptSegment,
)
from analyzers.clips import analyze_clips, ClipsConfig
from services.twitch import TwitchClient, VodStorage
from services.downloader import TwitchDownloader

app = FastAPI(title="ClipDetector API", version="0.1.0")

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
    allow_origins=["http://localhost:3000"],
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
        now = datetime.utcnow().isoformat()
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


@app.get("/data/vods/{filename:path}")
async def stream_video(filename: str, request: Request):
    """Stream video with Range request support for seeking."""
    video_path = DATA_DIR / "vods" / filename

    # Security check
    try:
        video_path = video_path.resolve()
        data_dir_resolved = DATA_DIR.resolve()
        if not str(video_path).startswith(str(data_dir_resolved)):
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
        # Parse "bytes=start-end" format
        range_match = range_header.replace("bytes=", "").split("-")
        start = int(range_match[0]) if range_match[0] else 0
        end = int(range_match[1]) if range_match[1] else file_size - 1

        # Clamp values
        start = max(0, min(start, file_size - 1))
        end = max(start, min(end, file_size - 1))
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


# Serve other static files (non-video)
if DATA_DIR.exists():
    app.mount("/data", StaticFiles(directory=DATA_DIR), name="data")


class AudioAnalysisRequest(BaseModel):
    file_path: str = Field(..., description="Path to video file relative to /data folder")
    threshold_multiplier: float = Field(
        default=2.5,
        ge=1.0,
        le=10.0,
        description="Spike threshold: loudness must exceed average by this factor"
    )
    window_seconds: float = Field(
        default=10.0,
        ge=1.0,
        le=60.0,
        description="Rolling window size for computing average loudness"
    )


class SpikeResult(BaseModel):
    timestamp: float
    intensity: float
    duration: float


class AudioAnalysisResponse(BaseModel):
    file_path: str
    spikes: list[SpikeResult]
    total_spikes: int
    config: dict


class ChatAnalysisRequest(BaseModel):
    file_path: str = Field(..., description="Path to chat JSON file relative to /data folder")


class MomentResult(BaseModel):
    timestamp: float
    intensity: float
    duration: float
    moment_type: str
    details: dict


class ChatAnalysisResponse(BaseModel):
    file_path: str
    moments: list[MomentResult]
    total_moments: int


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

    now = datetime.utcnow().isoformat()
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
    updated_dict["updated_at"] = datetime.utcnow().isoformat()
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


class FileListResponse(BaseModel):
    vods: list[str]
    chats: list[str]


@app.get("/api/files", response_model=FileListResponse)
async def list_files():
    """List available VOD and chat files."""
    vods_dir = DATA_DIR / "vods"
    chats_dir = DATA_DIR / "chats"

    vod_files = []
    chat_files = []

    if vods_dir.exists():
        vod_files = [
            f.name for f in vods_dir.iterdir()
            if f.is_file() and f.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"}
        ]

    if chats_dir.exists():
        chat_files = [
            f.name for f in chats_dir.iterdir()
            if f.is_file() and f.suffix.lower() == ".json"
        ]

    return FileListResponse(
        vods=sorted(vod_files),
        chats=sorted(chat_files),
    )


@app.post("/api/analyze/audio", response_model=AudioAnalysisResponse)
async def analyze_audio_endpoint(request: AudioAnalysisRequest):
    """Analyze a video file for audio loudness spikes.

    The file_path should be relative to the /data folder.
    Example: "vods/my_stream.mp4"
    """
    # Resolve the full path
    video_path = DATA_DIR / request.file_path

    # Security check: ensure the path is within data directory
    try:
        video_path = video_path.resolve()
        data_dir_resolved = DATA_DIR.resolve()
        if not str(video_path).startswith(str(data_dir_resolved)):
            raise HTTPException(status_code=400, detail="Invalid file path")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file path")

    if not video_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"File not found: {request.file_path}"
        )

    # Build config from request
    config = AnalysisConfig(
        threshold_multiplier=request.threshold_multiplier,
        window_seconds=request.window_seconds,
    )

    try:
        spikes = analyze_audio(video_path, config)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    return AudioAnalysisResponse(
        file_path=request.file_path,
        spikes=[
            SpikeResult(
                timestamp=s.timestamp,
                intensity=s.intensity,
                duration=s.duration
            )
            for s in spikes
        ],
        total_spikes=len(spikes),
        config={
            "threshold_multiplier": config.threshold_multiplier,
            "window_seconds": config.window_seconds,
            "chunk_ms": config.chunk_ms,
            "min_spike_gap": config.min_spike_gap,
        }
    )


@app.post("/api/analyze/chat", response_model=ChatAnalysisResponse)
async def analyze_chat_endpoint(request: ChatAnalysisRequest):
    """Analyze a chat JSON file for hype moments.

    The file_path should be relative to the /data folder.
    Example: "chats/my_stream_chat.json"
    """
    # Resolve the full path
    chat_path = DATA_DIR / request.file_path

    # Security check: ensure the path is within data directory
    try:
        chat_path = chat_path.resolve()
        data_dir_resolved = DATA_DIR.resolve()
        if not str(chat_path).startswith(str(data_dir_resolved)):
            raise HTTPException(status_code=400, detail="Invalid file path")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file path")

    if not chat_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"File not found: {request.file_path}"
        )

    try:
        moments = analyze_chat(chat_path)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON file: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return ChatAnalysisResponse(
        file_path=request.file_path,
        moments=[
            MomentResult(
                timestamp=m.timestamp,
                intensity=m.intensity,
                duration=m.duration,
                moment_type=m.moment_type,
                details=m.details,
            )
            for m in moments
        ],
        total_moments=len(moments),
    )


class SpeechAnalysisRequest(BaseModel):
    file_path: str = Field(..., description="Path to video file relative to /data folder")
    model_size: str = Field(
        default="base",
        description="Whisper model size: tiny, base, small, medium, large"
    )
    language: str = Field(
        default="en",
        description="Language code (e.g., 'en', 'es') or empty for auto-detection"
    )


class TranscriptSegmentResult(BaseModel):
    start: float
    end: float
    text: str


class SpeechMomentResult(BaseModel):
    timestamp: float
    intensity: float
    duration: float
    moment_type: str
    details: dict


class SpeechAnalysisResponse(BaseModel):
    file_path: str
    moments: list[SpeechMomentResult]
    total_moments: int
    transcript_segments: list[TranscriptSegmentResult]
    config: dict


@app.post("/api/analyze/speech", response_model=SpeechAnalysisResponse)
async def analyze_speech_endpoint(request: SpeechAnalysisRequest):
    """Analyze a video file for speech-based clip moments.

    Transcribes audio using Whisper and detects:
    - Keyword matches (excitement phrases like "oh my god", "let's go")
    - Speech rate spikes (talking unusually fast)

    The file_path should be relative to the /data folder.
    Example: "vods/my_stream.mp4"
    """
    try:
        video_path = resolve_safe_path(request.file_path, DATA_DIR)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid file path")

    if not video_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"File not found: {request.file_path}"
        )

    config = SpeechConfig(
        model_size=request.model_size,
        language=request.language,
    )

    try:
        moments, segments = analyze_speech(video_path, config)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return SpeechAnalysisResponse(
        file_path=request.file_path,
        moments=[
            SpeechMomentResult(
                timestamp=m.timestamp,
                intensity=m.intensity,
                duration=m.duration,
                moment_type=m.moment_type,
                details=m.details,
            )
            for m in moments
        ],
        total_moments=len(moments),
        transcript_segments=[
            TranscriptSegmentResult(
                start=s.start,
                end=s.end,
                text=s.text,
            )
            for s in segments
        ],
        config={
            "model_size": config.model_size,
            "language": config.language,
        }
    )


@app.get("/api/analyze/speech/stream")
async def analyze_speech_stream(
    file_path: str,
    model_size: str = "base",
    language: str = "en",
):
    """Stream speech analysis progress via Server-Sent Events.

    Use this endpoint for long VODs to get real-time progress updates.

    Query parameters:
    - file_path: Path to video file relative to /data folder
    - model_size: Whisper model size (tiny, base, small, medium, large)
    - language: Language code (e.g., 'en') or empty for auto-detection
    """
    try:
        video_path = resolve_safe_path(file_path, DATA_DIR)
    except ValueError:
        async def error_stream():
            yield f"event: error\ndata: {json.dumps({'error': 'Invalid file path'})}\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")

    if not video_path.exists():
        async def error_stream():
            yield f"event: error\ndata: {json.dumps({'error': f'File not found: {file_path}'})}\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")

    config = SpeechConfig(
        model_size=model_size,
        language=language,
    )

    import asyncio
    import queue
    import threading

    progress_queue: queue.Queue = queue.Queue()

    def progress_callback(stage: str, percent: int, message: str):
        progress_queue.put({
            "type": "progress",
            "stage": stage,
            "percent": percent,
            "message": message,
        })

    def run_analysis():
        try:
            moments, segments = analyze_speech(video_path, config, progress_callback)
            progress_queue.put({
                "type": "complete",
                "result": {
                    "file_path": file_path,
                    "moments": [
                        {
                            "timestamp": m.timestamp,
                            "intensity": m.intensity,
                            "duration": m.duration,
                            "moment_type": m.moment_type,
                            "details": m.details,
                        }
                        for m in moments
                    ],
                    "total_moments": len(moments),
                    "transcript_segments": [
                        {"start": s.start, "end": s.end, "text": s.text}
                        for s in segments
                    ],
                    "config": {
                        "model_size": config.model_size,
                        "language": config.language,
                    }
                }
            })
        except Exception as e:
            progress_queue.put({
                "type": "error",
                "error": str(e),
            })

    async def event_stream():
        thread = threading.Thread(target=run_analysis)
        thread.start()

        while True:
            try:
                item = progress_queue.get(timeout=0.1)
                if item["type"] == "progress":
                    yield f"event: progress\ndata: {json.dumps(item)}\n\n"
                elif item["type"] == "complete":
                    yield f"event: complete\ndata: {json.dumps(item['result'])}\n\n"
                    break
                elif item["type"] == "error":
                    yield f"event: error\ndata: {json.dumps({'error': item['error']})}\n\n"
                    break
            except queue.Empty:
                if not thread.is_alive():
                    break
                await asyncio.sleep(0.1)

        thread.join()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


class FullAnalysisRequest(BaseModel):
    video_path: str = Field(..., description="Path to video file relative to /data folder")
    chat_path: str = Field(..., description="Path to chat JSON file relative to /data folder")
    overlap_window: float = Field(
        default=10.0,
        ge=1.0,
        le=60.0,
        description="Signals within this many seconds are considered overlapping"
    )
    clip_buffer: float = Field(
        default=30.0,
        ge=5.0,
        le=120.0,
        description="Seconds before and after the moment to include in clip"
    )
    audio_weight: float | None = Field(default=None, ge=0.0, le=5.0)
    chat_weight: float | None = Field(default=None, ge=0.0, le=5.0)
    audio_threshold_multiplier: float | None = Field(default=None, ge=1.0, le=10.0)
    chat_threshold: float | None = Field(default=None, ge=1.0, le=10.0)
    audio_intensity_cap: float | None = Field(default=None, ge=1.0, le=10.0)
    synergy_bonus: float | None = Field(default=None, ge=0.0, le=2.0)
    min_score: float | None = Field(default=None, ge=0.0, le=50.0)
    include_speech: bool = Field(
        default=False,
        description="Include speech analysis (transcription + keyword/rate detection)"
    )
    speech_model_size: str = Field(
        default="base",
        description="Whisper model size: tiny, base, small, medium, large"
    )
    speech_language: str = Field(
        default="en",
        description="Language code for speech recognition"
    )
    speech_keyword_weight: float | None = Field(default=None, ge=0.0, le=5.0)
    speech_rate_weight: float | None = Field(default=None, ge=0.0, le=5.0)


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
        if not str(full_path).startswith(str(data_dir_resolved)):
            raise ValueError("Path traversal detected")
    except Exception:
        raise ValueError("Invalid path")
    return full_path


@app.post("/api/analyze/full", response_model=FullAnalysisResponse)
async def analyze_full_endpoint(request: FullAnalysisRequest):
    """Run full analysis pipeline: audio + chat + fusion.

    Analyzes both video (for audio spikes) and chat (for velocity/emote moments),
    then fuses the signals to produce ranked clip candidates.

    File paths should be relative to the /data folder.
    Example: video_path="vods/my_stream.mp4", chat_path="chats/my_stream_chat.json"
    """
    # Resolve and validate paths
    try:
        video_path = resolve_safe_path(request.video_path, DATA_DIR)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid video path")

    try:
        chat_path = resolve_safe_path(request.chat_path, DATA_DIR)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid chat path")

    if not video_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Video file not found: {request.video_path}"
        )

    if not chat_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Chat file not found: {request.chat_path}"
        )

    # Build configs from request (use defaults if not provided)
    audio_config = AudioConfig(
        threshold_multiplier=request.audio_threshold_multiplier or 2.5,
    )

    chat_config = ChatConfig(
        threshold=request.chat_threshold or 3.0,
    )

    fusion_config = FusionConfig(
        overlap_window=request.overlap_window,
        clip_buffer=request.clip_buffer,
        audio_weight=request.audio_weight or 1.0,
        chat_weight=request.chat_weight or 1.5,
        audio_intensity_cap=request.audio_intensity_cap or 2.5,
        synergy_bonus=request.synergy_bonus or 0.75,
        min_score=request.min_score or 3.0,
        speech_keyword_weight=request.speech_keyword_weight or 1.5,
        speech_rate_weight=request.speech_rate_weight or 1.0,
    )

    speech_config = None
    if request.include_speech:
        speech_config = SpeechConfig(
            model_size=request.speech_model_size,
            language=request.speech_language,
        )

    try:
        candidates = analyze_full(
            video_path,
            chat_path,
            audio_config=audio_config,
            chat_config=chat_config,
            fusion_config=fusion_config,
            include_speech=request.include_speech,
            speech_config=speech_config,
        )
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid chat JSON file: {e}")
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return FullAnalysisResponse(
        video_path=request.video_path,
        chat_path=request.chat_path,
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
        }
    )


@app.post("/api/analyze/full/stream")
async def analyze_full_stream(request: FullAnalysisRequest):
    """Stream full analysis progress via Server-Sent Events.

    Use this endpoint when speech analysis is enabled to get real-time progress updates.
    Returns the same response as /api/analyze/full but streams progress events.
    """
    import asyncio
    import queue
    import threading

    try:
        video_path = resolve_safe_path(request.video_path, DATA_DIR)
    except ValueError:
        async def error_stream():
            yield f"event: error\ndata: {json.dumps({'error': 'Invalid video path'})}\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")

    try:
        chat_path = resolve_safe_path(request.chat_path, DATA_DIR)
    except ValueError:
        async def error_stream():
            yield f"event: error\ndata: {json.dumps({'error': 'Invalid chat path'})}\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")

    if not video_path.exists():
        async def error_stream():
            yield f"event: error\ndata: {json.dumps({'error': f'Video file not found: {request.video_path}'})}\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")

    if not chat_path.exists():
        async def error_stream():
            yield f"event: error\ndata: {json.dumps({'error': f'Chat file not found: {request.chat_path}'})}\n\n"
        return StreamingResponse(error_stream(), media_type="text/event-stream")

    audio_config = AudioConfig(
        threshold_multiplier=request.audio_threshold_multiplier or 2.5,
    )
    chat_config = ChatConfig(
        threshold=request.chat_threshold or 3.0,
    )
    fusion_config = FusionConfig(
        overlap_window=request.overlap_window,
        clip_buffer=request.clip_buffer,
        audio_weight=request.audio_weight or 1.0,
        chat_weight=request.chat_weight or 1.5,
        audio_intensity_cap=request.audio_intensity_cap or 2.5,
        synergy_bonus=request.synergy_bonus or 0.75,
        min_score=request.min_score or 3.0,
        speech_keyword_weight=request.speech_keyword_weight or 1.5,
        speech_rate_weight=request.speech_rate_weight or 1.0,
    )
    speech_config = None
    if request.include_speech:
        speech_config = SpeechConfig(
            model_size=request.speech_model_size,
            language=request.speech_language,
        )

    progress_queue: queue.Queue = queue.Queue()

    def progress_callback(stage: str, percent: int, message: str):
        progress_queue.put({
            "type": "progress",
            "stage": stage,
            "percent": percent,
            "message": message,
        })

    def run_analysis():
        try:
            # Send initial progress
            progress_queue.put({
                "type": "progress",
                "stage": "analyzing",
                "percent": 0,
                "message": "Starting analysis...",
            })

            candidates = analyze_full(
                video_path,
                chat_path,
                audio_config=audio_config,
                chat_config=chat_config,
                fusion_config=fusion_config,
                include_speech=request.include_speech,
                speech_config=speech_config,
                speech_progress_callback=progress_callback if request.include_speech else None,
            )

            progress_queue.put({
                "type": "complete",
                "result": {
                    "video_path": request.video_path,
                    "chat_path": request.chat_path,
                    "candidates": [
                        {
                            "timestamp": c.timestamp,
                            "score": c.score,
                            "signals": c.signals,
                            "clip_start": c.clip_start,
                            "clip_end": c.clip_end,
                        }
                        for c in candidates
                    ],
                    "total_candidates": len(candidates),
                    "config": {
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
                    }
                }
            })
        except Exception as e:
            progress_queue.put({
                "type": "error",
                "error": str(e),
            })

    async def event_stream():
        thread = threading.Thread(target=run_analysis)
        thread.start()

        while True:
            try:
                item = progress_queue.get(timeout=0.5)
                if item["type"] == "progress":
                    yield f"event: progress\ndata: {json.dumps(item)}\n\n"
                elif item["type"] == "complete":
                    yield f"event: complete\ndata: {json.dumps(item['result'])}\n\n"
                    break
                elif item["type"] == "error":
                    yield f"event: error\ndata: {json.dumps({'error': item['error']})}\n\n"
                    break
            except queue.Empty:
                if not thread.is_alive():
                    break
                await asyncio.sleep(0.1)

        thread.join()

    return StreamingResponse(event_stream(), media_type="text/event-stream")


class ClipExportRequest(BaseModel):
    vod_path: str = Field(..., description="Path to VOD file relative to /data folder")
    start_time: float = Field(..., ge=0, description="Start timestamp in seconds")
    end_time: float = Field(..., gt=0, description="End timestamp in seconds")
    output_filename: str = Field(..., description="Output filename (without path)")


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
        threshold_multiplier=request.audio_threshold_multiplier or 2.5,
    )

    chat_config = ChatConfig(
        threshold=request.chat_threshold or 3.0,
    )

    fusion_config = FusionConfig(
        overlap_window=request.overlap_window,
        clip_buffer=request.clip_buffer,
        audio_weight=request.audio_weight or 1.0,
        chat_weight=request.chat_weight or 1.5,
        audio_intensity_cap=request.audio_intensity_cap or 2.5,
        synergy_bonus=request.synergy_bonus or 0.75,
        min_score=request.min_score or 3.0,
        speech_keyword_weight=request.speech_keyword_weight or 1.5,
        speech_rate_weight=request.speech_rate_weight or 1.0,
        clip_popular_weight=request.clip_popular_weight or 3.5,
        clip_density_weight=request.clip_density_weight or 2.5,
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
