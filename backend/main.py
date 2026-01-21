import json
import os
import re
import subprocess
from datetime import datetime
from enum import Enum
from pathlib import Path

import httpx

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
from analyzers.lipsync import (
    generate_lipsync_video,
    validate_avatar,
    get_available_avatars,
    LipsyncConfig,
    RhubarbNotFoundError,
    AvatarNotFoundError,
    MissingMouthShapeError,
)

app = FastAPI(title="ClipDetector API", version="0.1.0")

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
AVATARS_DIR = DATA_DIR / "avatars"


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


class ProfileCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    audio_weight: float = Field(default=1.0, ge=0.0, le=5.0)
    chat_weight: float = Field(default=1.5, ge=0.0, le=5.0)
    audio_threshold_multiplier: float = Field(default=2.5, ge=1.0, le=10.0)
    chat_threshold: float = Field(default=3.0, ge=1.0, le=10.0)
    audio_intensity_cap: float = Field(default=2.5, ge=1.0, le=10.0)
    synergy_bonus: float = Field(default=0.75, ge=0.0, le=2.0)
    min_score: float = Field(default=3.0, ge=0.0, le=50.0)


class ProfileUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    audio_weight: float | None = Field(default=None, ge=0.0, le=5.0)
    chat_weight: float | None = Field(default=None, ge=0.0, le=5.0)
    audio_threshold_multiplier: float | None = Field(default=None, ge=1.0, le=10.0)
    chat_threshold: float | None = Field(default=None, ge=1.0, le=10.0)
    audio_intensity_cap: float | None = Field(default=None, ge=1.0, le=10.0)
    synergy_bonus: float | None = Field(default=None, ge=0.0, le=2.0)
    min_score: float | None = Field(default=None, ge=0.0, le=50.0)


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


class TTSVoice(str, Enum):
    BRITISH_RYAN = "en-GB-RyanNeural"
    AMERICAN_ANDREW = "en-US-AndrewNeural"


class TTSPreviewRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=500)
    voice: TTSVoice = Field(default=TTSVoice.BRITISH_RYAN)
    speed: float = Field(default=1.0, ge=0.5, le=2.0)


class TTSGenerateRequest(TTSPreviewRequest):
    output_filename: str = Field(..., description="Output filename (without path)")
    avatar: str | None = Field(default=None, description="Optional avatar for lip-sync video")


class TTSGenerateResponse(BaseModel):
    success: bool
    output_path: str | None = None
    duration_seconds: float
    file_size: int
    video_path: str | None = None


class TTSAnimateRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=500)
    voice: TTSVoice = Field(default=TTSVoice.BRITISH_RYAN)
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    avatar: str = Field(..., description="Avatar name (e.g., 'bernard', 'queso')")
    output_filename: str = Field(..., description="Output filename (without path)")


class TTSAnimateResponse(BaseModel):
    success: bool
    video_path: str
    audio_path: str
    duration_seconds: float


TTS_API_URL = "http://localhost:5050/v1/audio/speech"


def get_audio_duration(file_path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "quiet",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(file_path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode == 0 and result.stdout.strip():
        return float(result.stdout.strip())
    return 0.0


@app.post("/api/tts/preview")
async def preview_tts(request: TTSPreviewRequest):
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                TTS_API_URL,
                json={
                    "model": "tts-1",
                    "input": request.text,
                    "voice": request.voice.value,
                    "speed": request.speed,
                    "response_format": "mp3",
                },
                headers={
                    "Content-Type": "application/json",
                    "Authorization": "Bearer your_api_key_here",
                },
                timeout=30.0,
            )

            if response.status_code != 200:
                raise HTTPException(
                    status_code=500,
                    detail=f"TTS API error: {response.text[:200]}"
                )

            return StreamingResponse(
                iter([response.content]),
                media_type="audio/mpeg",
                headers={"Content-Disposition": "inline"},
            )
        except httpx.ConnectError:
            raise HTTPException(
                status_code=503,
                detail="TTS service unavailable - ensure openai-edge-tts is running on port 5050"
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="TTS request timed out"
            )


@app.post("/api/tts/generate", response_model=TTSGenerateResponse)
async def generate_tts(request: TTSGenerateRequest):
    clips_dir = DATA_DIR / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)

    safe_filename = "".join(
        c for c in request.output_filename
        if c.isalnum() or c in "._-"
    )
    if not safe_filename.endswith(".mp3"):
        safe_filename += ".mp3"

    output_path = clips_dir / safe_filename

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                TTS_API_URL,
                json={
                    "model": "tts-1",
                    "input": request.text,
                    "voice": request.voice.value,
                    "speed": request.speed,
                    "response_format": "mp3",
                },
                headers={
                    "Content-Type": "application/json",
                    "Authorization": "Bearer your_api_key_here",
                },
                timeout=30.0,
            )

            if response.status_code != 200:
                raise HTTPException(
                    status_code=500,
                    detail=f"TTS API error: {response.text[:200]}"
                )

            output_path.write_bytes(response.content)

        except httpx.ConnectError:
            raise HTTPException(
                status_code=503,
                detail="TTS service unavailable - ensure openai-edge-tts is running on port 5050"
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="TTS request timed out"
            )

    if not output_path.exists():
        raise HTTPException(
            status_code=500,
            detail="TTS generation failed - output file not created"
        )

    duration = get_audio_duration(output_path)
    file_size = output_path.stat().st_size

    video_path_str = None
    if request.avatar:
        try:
            avatar_path = validate_avatar(AVATARS_DIR, request.avatar)
        except AvatarNotFoundError as e:
            output_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=404,
                detail=f"Avatar '{e.avatar_name}' not found. Available: {', '.join(e.available_avatars)}"
            )
        except MissingMouthShapeError as e:
            output_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=400,
                detail=f"Avatar '{e.avatar_name}' is missing mouth shapes: {', '.join(e.missing_shapes)}"
            )

        video_filename = safe_filename.replace(".mp3", ".mp4")
        video_path = clips_dir / video_filename

        try:
            generate_lipsync_video(
                audio_path=output_path,
                avatar_path=avatar_path,
                output_path=video_path,
                config=LipsyncConfig()
            )
            video_path_str = f"clips/{video_filename}"
            output_path.unlink(missing_ok=True)
            file_size = video_path.stat().st_size
        except RhubarbNotFoundError:
            output_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=500,
                detail="Rhubarb not found. Expected at backend/bin/Rhubarb-Lip-Sync-1.14.0-macOS/rhubarb"
            )
        except RuntimeError as e:
            output_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=500,
                detail=f"Lip-sync generation failed: {str(e)[:200]}"
            )

    audio_output_path = None if request.avatar else f"clips/{safe_filename}"

    return TTSGenerateResponse(
        success=True,
        output_path=audio_output_path,
        duration_seconds=duration,
        file_size=file_size,
        video_path=video_path_str,
    )


@app.get("/api/avatars")
async def list_avatars():
    return {"avatars": get_available_avatars(AVATARS_DIR)}


@app.post("/api/tts/animate", response_model=TTSAnimateResponse)
async def animate_tts(request: TTSAnimateRequest):
    try:
        avatar_path = validate_avatar(AVATARS_DIR, request.avatar)
    except AvatarNotFoundError as e:
        raise HTTPException(
            status_code=404,
            detail=f"Avatar '{e.avatar_name}' not found. Available: {', '.join(e.available_avatars)}"
        )
    except MissingMouthShapeError as e:
        raise HTTPException(
            status_code=400,
            detail=f"Avatar '{e.avatar_name}' is missing mouth shapes: {', '.join(e.missing_shapes)}"
        )

    clips_dir = DATA_DIR / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)

    safe_base = "".join(c for c in request.output_filename if c.isalnum() or c in "._-")
    if safe_base.endswith(".mp4"):
        safe_base = safe_base[:-4]
    if safe_base.endswith(".mp3"):
        safe_base = safe_base[:-4]

    audio_filename = f"{safe_base}.mp3"
    video_filename = f"{safe_base}.mp4"
    audio_path = clips_dir / audio_filename
    video_path = clips_dir / video_filename

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                TTS_API_URL,
                json={
                    "model": "tts-1",
                    "input": request.text,
                    "voice": request.voice.value,
                    "speed": request.speed,
                    "response_format": "mp3",
                },
                headers={
                    "Content-Type": "application/json",
                    "Authorization": "Bearer your_api_key_here",
                },
                timeout=30.0,
            )

            if response.status_code != 200:
                raise HTTPException(
                    status_code=500,
                    detail=f"TTS API error: {response.text[:200]}"
                )

            audio_path.write_bytes(response.content)

        except httpx.ConnectError:
            raise HTTPException(
                status_code=503,
                detail="TTS service unavailable - ensure openai-edge-tts is running on port 5050"
            )
        except httpx.TimeoutException:
            raise HTTPException(
                status_code=504,
                detail="TTS request timed out"
            )

    try:
        generate_lipsync_video(
            audio_path=audio_path,
            avatar_path=avatar_path,
            output_path=video_path,
            config=LipsyncConfig()
        )
    except RhubarbNotFoundError:
        audio_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=500,
            detail="Rhubarb not found. Expected at backend/bin/Rhubarb-Lip-Sync-1.14.0-macOS/rhubarb"
        )
    except RuntimeError as e:
        audio_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=500,
            detail=f"Lip-sync generation failed: {str(e)[:200]}"
        )

    duration = get_audio_duration(audio_path)

    return TTSAnimateResponse(
        success=True,
        video_path=f"clips/{video_filename}",
        audio_path=f"clips/{audio_filename}",
        duration_seconds=duration,
    )
