# ClipDetector

A local application that analyzes Twitch VODs to detect clip-worthy moments.

## Overview

ClipDetector processes locally downloaded Twitch VODs (video files + JSON chat logs) and detects clip-worthy moments by analyzing:

- **Chat activity**: Message velocity, emote spam, keywords
- **Audio levels**: Loudness spikes and peaks
- **Speech content**: Transcription, excitement phrases, and speaking rate

When a clip-worthy moment is detected, the system grabs 30 seconds before and after the timestamp. Candidates are surfaced in a web UI for review, trimming, and export.

## Quick start

ClipDetector requires Python 3.12, Node.js 20.9 or newer, FFmpeg, and optionally TwitchDownloaderCLI. Complete platform-specific installation, credential, verification, and troubleshooting instructions are in the **[development setup guide](docs/DEVELOPMENT.md)**.

For a new macOS checkout with prerequisites already installed:

```bash
# Backend dependencies
cd backend
python3.12 -m venv venv
source venv/bin/activate
python -m pip install -r requirements.txt
python -m pip check

# Frontend dependencies
cd ../frontend
npm ci

# Local configuration (these checks preserve existing local settings)
cd ..
test -f backend/.env || cp backend/.env.example backend/.env
test -f config.json || cp config.example.json config.json

# Start both services
./start.sh
```

Fill in `backend/.env` and update `config.json` before using Twitch features. The example configuration leaves automation off so the first startup does not immediately download or process VODs.

- Frontend: <http://localhost:3000>
- Backend: <http://localhost:8000>
- Health check: <http://localhost:8000/health>

## Project structure

```
ClipDetector/
├── backend/              # Python FastAPI backend
│   ├── main.py           # API entry point
│   ├── requirements.txt
│   └── analyzers/        # Analysis modules
│       ├── audio.py      # Audio spike detection
│       ├── chat.py       # Chat hype moment detection
│       ├── speech.py     # Speech transcription + keyword detection
│       └── fusion.py     # Signal fusion and clip ranking
├── frontend/             # Next.js React frontend
│   └── src/app/          # Analysis, VOD, review, and clip pages
├── data/                 # Local VODs, chat logs, clips, and profiles
│   ├── vods/             # Place VOD video files here
│   ├── chats/            # Place chat JSON files here
│   ├── clips/            # Exported clips
├── pi-notifier/          # Optional Raspberry Pi event listener
├── docs/                 # Reference documentation
└── README.md
```

## Automation

When enabled, the automation pipeline runs immediately when the backend starts and then every two hours by default (configurable in `config.json`). Each run:

1. Checks configured Twitch channels for new VODs
2. Analyzes and downloads the top clips per VOD
3. Converts clips to vertical format for mobile

Converted clips are written to `data/clips/` and reviewed from the frontend.

The backend must remain running for scheduled automation. The frontend is only needed for browser-based review and control.

## Pi notifier (optional)

The Pi notifier is a lightweight service that runs on a Raspberry Pi and triggers the ClipDetector pipeline immediately when a monitored stream goes offline, instead of waiting for the next scheduler cycle.

On the Pi, set the environment variable:
```
CLIPDETECTOR_URL=http://<your-laptop-ip>:8000
```

See [pi-notifier/README.md](pi-notifier/README.md) for build, deploy, and systemd service instructions.

## Usage

1. Add Twitch credentials to `backend/.env` and channel names to `config.json`.
2. Start ClipDetector with `./start.sh`.
3. Open <http://localhost:3000/vods>, refresh the VOD list, and download a VOD. ClipDetector downloads the matching chat log with it.
4. Open <http://localhost:3000>, select the downloaded VOD and an analysis profile, then run the analysis.
5. Review the candidates at <http://localhost:3000/review> and approve or reject each clip.
6. Export approved clips. ClipDetector saves them in `data/clips/`.

## API endpoints

### Health check

```bash
curl http://localhost:8000/health
```

### Analysis

Analyze a downloaded VOD by ID. Video and chat paths are resolved from the VOD
store, so no file paths are passed in:

```bash
# Basic usage (profile defaults apply)
curl -X POST http://localhost:8000/api/vods/{vod_id}/analyze \
  -H "Content-Type: application/json" \
  -d '{}'

# With speech analysis enabled
curl -X POST http://localhost:8000/api/vods/{vod_id}/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "include_speech": true,
    "speech_model_size": "base",
    "clip_buffer": 30.0
  }'
```

**Parameters** (all optional):
- `overlap_window` (default: 10.0): Signals within this many seconds are combined
- `clip_buffer` (default: 30.0): Seconds before and after the moment to include
- `include_speech` (default: false): Enable Whisper transcription and keyword detection
- `speech_model_size` (default: "base"): Whisper model size (tiny, base, small, medium, large)
- `speech_language` (default: "en"): Language code, or empty for auto-detection
- `include_clips` (default: true): Fold published Twitch clips into the ranking
- Weight overrides: `audio_weight`, `chat_weight`, `audio_threshold_multiplier`,
  `chat_threshold`, `audio_intensity_cap`, `synergy_bonus`, `min_score`,
  `speech_keyword_weight`, `speech_rate_weight`, `clip_popular_weight`,
  `clip_density_weight`

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

**Signal types:**
- `audio`: Loudness exceeding the rolling average by `audio_threshold_multiplier`
- `velocity_spike`: Sudden increase in chat messages per second versus the rolling baseline
- `emote_flood`: High concentration of emotes in a window (50%+ of messages contain emotes)
- `keyword_match`: Excitement phrases like "oh my god", "let's go", "no way" (speech enabled)
- `speech_rate_spike`: Speaking 1.5x+ faster than baseline (speech enabled)
- `clip_popular` / `clip_density`: Derived from published Twitch clips over the VOD

**Scoring:**
- Audio spikes: base weight 1.0 × intensity
- Chat velocity spikes: base weight 1.5 × intensity (strong signal)
- Emote floods: base weight 1.0 × intensity
- Speech keyword matches: base weight 1.5 × intensity (when speech enabled)
- Speech rate spikes: base weight 1.0 × intensity (when speech enabled)
- Overlapping signals are combined with a 75% synergy bonus per additional signal type
- Candidates within 30 seconds are deduplicated (highest score wins)
- Results are sorted by score descending

### Clip export

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

## Checks

Run the backend tests from the repository root:

```bash
cd backend
source venv/bin/activate
python -m unittest discover -s tests -v
```

Run the frontend checks:

```bash
cd frontend
npm run lint
npm run build
```

Build the optional Pi notifier:

```bash
cd pi-notifier
bun run build:node
```

## Development

- Backend uses FastAPI with automatic reload
- Frontend uses Next.js App Router with TypeScript
- CORS is configured to allow frontend-backend communication on localhost

## Copyright

Copyright (c) 2026 Asher Harris. All rights reserved.

The source code is available for portfolio review. [GitHub's Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) grant limited rights for public repositories. No other permission is granted to use, copy, modify, or distribute this software.
