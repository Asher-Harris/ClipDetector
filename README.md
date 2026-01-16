# ClipDetector

A local application that analyzes Twitch VODs to detect clip-worthy moments.

## Overview

ClipDetector processes locally downloaded Twitch VODs (video files + JSON chat logs) and detects clip-worthy moments by analyzing:

- **Chat activity**: Message velocity, emote spam, keywords
- **Audio levels**: Loudness spikes and peaks
- **Facial expressions**: (Coming later)

When a clip-worthy moment is detected, the system grabs 30 seconds before and after the timestamp. Candidates are surfaced in a web UI for review, trimming, and export.

## Project Structure

```
ClipDetector/
├── backend/              # Python FastAPI backend
│   ├── main.py           # API entry point
│   ├── requirements.txt
│   └── analyzers/        # Analysis modules
│       ├── audio.py      # Audio spike detection
│       ├── chat.py       # Chat hype moment detection
│       └── fusion.py     # Signal fusion and clip ranking
├── frontend/             # Next.js React frontend
│   └── src/app/          # App router pages (/, /review)
├── data/                 # Local data storage (git-ignored)
│   ├── vods/             # Place VOD video files here
│   ├── chats/            # Place chat JSON files here
│   └── clips/            # Exported clips saved here
└── README.md
```

## Prerequisites

- Python 3.10+
- Node.js 18+
- FFmpeg (for video processing)

## Setup

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip3 install -r requirements.txt
```

### Frontend

```bash
cd frontend
npm install
```

## Running the Application

### Start the Backend

```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload
```

The API will be available at http://localhost:8000

### Start the Frontend

```bash
cd frontend
npm run dev
```

The UI will be available at http://localhost:3000

## Usage

1. Download a Twitch VOD and its chat log
2. Place the video file in `data/vods/`
3. Place the chat JSON in `data/chats/`
4. Open http://localhost:3000 and select your VOD and chat files
5. Run analysis to detect clip candidates
6. Review candidates at `/review` - approve, reject, and trim clips
7. Export approved clips to `data/clips/`

## API Endpoints

### Health Check

```bash
curl http://localhost:8000/health
```

### Audio Analysis

Analyze a video file for loudness spikes:

```bash
# Basic usage (uses default thresholds)
curl -X POST http://localhost:8000/api/analyze/audio \
  -H "Content-Type: application/json" \
  -d '{"file_path": "vods/my_stream.mp4"}'

# With custom threshold (lower = more sensitive)
curl -X POST http://localhost:8000/api/analyze/audio \
  -H "Content-Type: application/json" \
  -d '{
    "file_path": "vods/my_stream.mp4",
    "threshold_multiplier": 2.0,
    "window_seconds": 10.0
  }'
```

**Parameters:**
- `file_path` (required): Path to video relative to `/data` folder
- `threshold_multiplier` (default: 2.5): Spike detected when loudness exceeds average by this factor
- `window_seconds` (default: 10.0): Rolling window for computing average loudness

**Response:**
```json
{
  "file_path": "vods/my_stream.mp4",
  "spikes": [
    {"timestamp": 125.3, "intensity": 1.8, "duration": 0.5},
    {"timestamp": 342.1, "intensity": 2.1, "duration": 0.3}
  ],
  "total_spikes": 2,
  "config": {...}
}
```

### Chat Analysis

Analyze a chat JSON file for hype moments (velocity spikes and emote floods):

```bash
curl -X POST http://localhost:8000/api/analyze/chat \
  -H "Content-Type: application/json" \
  -d '{"file_path": "chats/my_stream_chat.json"}'
```

**Parameters:**
- `file_path` (required): Path to chat JSON file relative to `/data` folder

**Response:**
```json
{
  "file_path": "chats/my_stream_chat.json",
  "moments": [
    {
      "timestamp": 125.5,
      "intensity": 1.5,
      "duration": 5.0,
      "moment_type": "velocity_spike",
      "details": {"messages_in_window": 45, "messages_per_second": 9.0, "baseline_per_second": 2.1}
    },
    {
      "timestamp": 130.0,
      "intensity": 1.2,
      "duration": 5.0,
      "moment_type": "emote_flood",
      "details": {"messages_in_window": 28, "emote_messages": 18, "total_emotes": 24, "emote_ratio": 0.64}
    }
  ],
  "total_moments": 2
}
```

**Moment types:**
- `velocity_spike`: Sudden increase in messages per second compared to rolling baseline
- `emote_flood`: High concentration of emotes in a time window (50%+ of messages contain emotes)

### Full Analysis (Fusion)

Run the complete pipeline: audio analysis + chat analysis + signal fusion to get ranked clip candidates:

```bash
# Basic usage
curl -X POST http://localhost:8000/api/analyze/full \
  -H "Content-Type: application/json" \
  -d '{
    "video_path": "vods/my_stream.mp4",
    "chat_path": "chats/my_stream_chat.json"
  }'

# With custom parameters
curl -X POST http://localhost:8000/api/analyze/full \
  -H "Content-Type: application/json" \
  -d '{
    "video_path": "vods/my_stream.mp4",
    "chat_path": "chats/my_stream_chat.json",
    "overlap_window": 10.0,
    "clip_buffer": 30.0
  }'
```

**Parameters:**
- `video_path` (required): Path to video file relative to `/data` folder
- `chat_path` (required): Path to chat JSON file relative to `/data` folder
- `overlap_window` (default: 10.0): Signals within this many seconds are combined
- `clip_buffer` (default: 30.0): Seconds before and after the moment to include

**Response:**
```json
{
  "video_path": "vods/my_stream.mp4",
  "chat_path": "chats/my_stream_chat.json",
  "candidates": [
    {
      "timestamp": 125.5,
      "score": 4.32,
      "signals": ["audio", "velocity_spike", "emote_flood"],
      "clip_start": 95.5,
      "clip_end": 155.5
    },
    {
      "timestamp": 342.1,
      "score": 2.1,
      "signals": ["audio"],
      "clip_start": 312.1,
      "clip_end": 372.1
    }
  ],
  "total_candidates": 2,
  "config": {...}
}
```

**Scoring:**
- Audio spikes: base weight 1.0 × intensity
- Chat velocity spikes: base weight 1.5 × intensity (strong signal)
- Emote floods: base weight 1.0 × intensity
- Overlapping signals are combined with a 20% synergy bonus per additional signal type
- Candidates within 30 seconds are deduplicated (highest score wins)
- Results are sorted by score descending

### Clip Export

Export a clip segment from a VOD using FFmpeg:

```bash
curl -X POST http://localhost:8000/api/clips/export \
  -H "Content-Type: application/json" \
  -d '{
    "vod_path": "vods/my_stream.mp4",
    "start_time": 95.5,
    "end_time": 155.5,
    "output_filename": "my_clip.mp4"
  }'
```

**Parameters:**
- `vod_path` (required): Path to VOD file relative to `/data` folder
- `start_time` (required): Start timestamp in seconds
- `end_time` (required): End timestamp in seconds
- `output_filename` (required): Output filename (saved to `data/clips/`)

**Response:**
```json
{
  "success": true,
  "output_path": "clips/my_clip.mp4",
  "duration": 60.0,
  "file_size": 12345678
}
```

Uses stream copy (`-c copy`) for fast extraction, falling back to re-encoding if needed.

## Development

- Backend uses FastAPI with automatic reload
- Frontend uses Next.js App Router with TypeScript
- CORS is configured to allow frontend-backend communication on localhost
