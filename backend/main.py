import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from analyzers.audio import analyze_audio, AnalysisConfig, AudioSpike
from analyzers.chat import analyze_chat, ChatMoment

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
