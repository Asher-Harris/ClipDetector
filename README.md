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
│       └── audio.py      # Audio spike detection
├── frontend/             # Next.js React frontend
│   └── src/app/          # App router pages
├── data/                 # Local data storage (git-ignored)
│   ├── vods/             # Place VOD video files here
│   └── chats/            # Place chat JSON files here
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
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
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
4. Process the VOD through the UI (coming soon)
5. Review detected clip candidates
6. Trim and export clips

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

## Development

- Backend uses FastAPI with automatic reload
- Frontend uses Next.js App Router with TypeScript
- CORS is configured to allow frontend-backend communication on localhost
