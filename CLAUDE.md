# ClipDetector

Automatic clip detection for VODs using audio spikes and chat analysis.

## Structure

```
backend/          # FastAPI Python API
  main.py         # All endpoints
  analyzers/      # audio.py, chat.py, fusion.py, lipsync.py
  services/       # twitch.py, downloader.py (Twitch API & downloads)
  bin/            # External binaries (gitignored)
  .env            # Credentials (gitignored, copy from .env.example)
frontend/         # Next.js 16 + React 19 + TypeScript + Tailwind
  src/app/        # Pages (/, /review, /vods)
  src/components/ # UI components
  src/lib/        # api.ts, types.ts, utils
  src/context/    # AppContext (global state)
data/
  vods/           # Input video files (downloaded or manual)
  chats/          # Chat JSON files (downloaded or manual)
  clips/          # Exported clips, TTS audio, and animated videos
  avatars/        # Avatar mouth shape PNGs (A.png, B.png per avatar)
  twitch/         # VOD metadata cache (vods.json)
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
GET  /api/config              - Get feature configuration
POST /api/analyze/full        - Run analysis (video_path, chat_path)
POST /api/clips/export        - Export clip via FFmpeg (vod_path, start_time, end_time, output_filename)
POST /api/tts/preview         - Preview TTS audio (text, voice, speed) - returns audio stream
POST /api/tts/generate        - Generate and save TTS audio (text, voice, speed, output_filename, avatar?)
POST /api/tts/animate         - Generate TTS with lip-sync video (text, voice, speed, avatar, output_filename)
GET  /api/avatars             - List available avatars
GET  /data/vods/{file}        - Stream video
GET  /api/twitch/vods         - List cached Twitch VODs
POST /api/twitch/vods/refresh - Fetch fresh VODs from Twitch API
POST /api/twitch/vods/{id}/download - Download VOD + chat (SSE progress)
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

### Feature Flags (config.json)

Edit `config.json` in the project root to toggle features and configure options:

```json
{
  "features": {
    "speech_analysis": true
  },
  "twitch": {
    "channels": ["jynxzi", "caseoh_"],
    "cli_path": "TwitchDownloaderCLI"
  }
}
```

- `speech_analysis` - Enable/disable speech transcription feature (requires Whisper)
- `twitch.channels` - List of Twitch channel logins to fetch VODs from
- `twitch.cli_path` - Path to TwitchDownloaderCLI binary

### Credentials (backend/.env)

**IMPORTANT:** API credentials and secrets go in `backend/.env`, NOT in config.json. Copy `backend/.env.example` to `backend/.env` and fill in your values:

```bash
TWITCH_CLIENT_ID=your_client_id_here
TWITCH_CLIENT_SECRET=your_client_secret_here
```

Get Twitch credentials from https://dev.twitch.tv/console

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
