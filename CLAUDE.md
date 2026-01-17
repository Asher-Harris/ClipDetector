# ClipDetector

Automatic clip detection for VODs using audio spikes and chat analysis.

## Structure

```
backend/          # FastAPI Python API
  main.py         # All endpoints
  analyzers/      # audio.py, chat.py, fusion.py
frontend/         # Next.js 16 + React 19 + TypeScript + Tailwind
  src/app/        # Pages (/, /review)
  src/components/ # UI components
  src/lib/        # api.ts, types.ts, utils
  src/context/    # AppContext (global state)
data/
  vods/           # Input video files
  chats/          # Chat JSON files
  clips/          # Exported clips and TTS intro audio files
```

## Commands

```bash
cd backend && uvicorn main:app --reload    # Backend :8000
cd frontend && npm run dev                  # Frontend :3000
```

## API Endpoints

```
POST /api/analyze/full   - Run analysis (video_path, chat_path)
POST /api/clips/export   - Export clip via FFmpeg (vod_path, start_time, end_time, output_filename)
POST /api/tts/preview    - Preview TTS audio (text, voice, speed) - returns audio stream
POST /api/tts/generate   - Generate and save TTS audio (text, voice, speed, output_filename)
GET  /data/vods/{file}   - Stream video
```

## TTS Integration

Requires openai-edge-tts running on port 5050. Available voices:
- `en-GB-RyanNeural` (British male)
- `en-US-AndrewNeural` (American male)

## Supported Formats

- **Video**: .mp4, .mkv, .webm, .mov
- **Chat**: JSON (Twitch chat-downloader format)

## Code Style

- **No console.logs** - remove debug logging before committing
- **Self-documenting code** - prefer clear variable/function names over comments
- **No unnecessary comments** - if you need a comment, rename the variable instead
- **Keep it simple** - avoid over-engineering, only build what's needed
