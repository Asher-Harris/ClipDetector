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
├── backend/          # Python FastAPI backend
│   ├── main.py       # API entry point
│   └── requirements.txt
├── frontend/         # Next.js React frontend
│   └── src/app/      # App router pages
├── data/             # Local data storage (git-ignored)
│   ├── vods/         # Place VOD video files here
│   └── chats/        # Place chat JSON files here
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

- `GET /health` - Health check endpoint

## Development

- Backend uses FastAPI with automatic reload
- Frontend uses Next.js App Router with TypeScript
- CORS is configured to allow frontend-backend communication on localhost
