# ClipDetector

Automatic clip detection for VODs using audio spikes and chat analysis.

## Structure

```
backend/          # FastAPI Python API
  main.py         # All endpoints
  analyzers/      # audio.py, chat.py, fusion.py, lipsync.py
  bin/            # External binaries (gitignored)
frontend/         # Next.js 16 + React 19 + TypeScript + Tailwind
  src/app/        # Pages (/, /review)
  src/components/ # UI components
  src/lib/        # api.ts, types.ts, utils
  src/context/    # AppContext (global state)
data/
  vods/           # Input video files
  chats/          # Chat JSON files
  clips/          # Exported clips, TTS audio, and animated videos
  avatars/        # Avatar mouth shape PNGs (A.png, B.png per avatar)
```

## Commands

```bash
./start.sh                                  # Start all services (recommended)

# Or run individually:
cd backend && source venv/bin/activate && uvicorn main:app --reload    # Backend :8000
cd frontend && npm run dev                  # Frontend :3000
```

## API Endpoints

```
GET  /api/config         - Get feature configuration
POST /api/analyze/full   - Run analysis (video_path, chat_path)
POST /api/clips/export   - Export clip via FFmpeg (vod_path, start_time, end_time, output_filename)
POST /api/tts/preview    - Preview TTS audio (text, voice, speed) - returns audio stream
POST /api/tts/generate   - Generate and save TTS audio (text, voice, speed, output_filename, avatar?)
POST /api/tts/animate    - Generate TTS with lip-sync video (text, voice, speed, avatar, output_filename)
GET  /api/avatars        - List available avatars
GET  /data/vods/{file}   - Stream video
```

## Dependencies

### Services (run separately)
- **openai-edge-tts** - TTS service on port 5050 (Docker recommended)

### External Binaries (place in backend/bin/)
- **Rhubarb Lip Sync** - For lip-sync analysis. Download from https://github.com/DanielSWolf/rhubarb-lip-sync
  - Expected path: `backend/bin/Rhubarb-Lip-Sync-1.14.0-macOS/rhubarb`
- **Twitch Downloader** - For downloading chat logs (optional)

## TTS & Lip-Sync

Available voices:
- `en-GB-RyanNeural` (British male)
- `en-US-AndrewNeural` (American male)

Avatar requirements (in `data/avatars/{name}/`):
- PNG files: A.png (mouth closed), B.png (mouth open)
- Recommended size: 800x800 or 1024x1024
- Output video uses green background (#00FF00) for chroma key

## Configuration

Edit `config.json` in the project root to toggle features:

```json
{
  "features": {
    "speech_analysis": true
  }
}
```

- `speech_analysis` - Enable/disable speech transcription feature (requires Whisper)

## Supported Formats

- **Video**: .mp4, .mkv, .webm, .mov
- **Chat**: JSON (Twitch chat-downloader format)

## Code Style

- **No console.logs** - remove debug logging before committing
- **Self-documenting code** - prefer clear variable/function names over comments
- **No unnecessary comments** - if you need a comment, rename the variable instead
- **Keep it simple** - avoid over-engineering, only build what's needed

## Dev Environment

- **Do not start dev servers** - the user runs the dev environment separately. Starting another instance causes port conflicts and other issues.
