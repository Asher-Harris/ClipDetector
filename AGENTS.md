# ClipDetector

Automatic clip detection for VODs using audio spikes and chat analysis.

## Commands

```bash
./start.sh                                  # Start all services (recommended)

# Or run individually:
cd backend && source venv/bin/activate && uvicorn main:app --reload    # Backend :8000
cd frontend && npm run dev                  # Frontend :3000
```

## API Endpoints

```
POST /api/vods/{id}/analyze   - Run analysis on a downloaded VOD
POST /api/clips/export        - Export clip via FFmpeg (vod_path, start_time, end_time, output_filename)
GET  /data/vods/{file}        - Stream video
GET  /api/twitch/vods         - List cached Twitch VODs
POST /api/twitch/vods/refresh - Fetch fresh VODs from Twitch API
POST /api/twitch/vods/{id}/download - Download VOD + chat (SSE progress)
POST /api/automation/run      - Trigger the automation pipeline
```

## Configuration

Edit `config.json` in the project root to configure Twitch and optional automation:

```json
{
  "twitch": {
    "channels": ["jynxzi", "caseoh_"],
    "cli_path": "TwitchDownloaderCLI"
  },
  "automation": {
    "enabled": false,
    "check_interval_hours": 2,
    "top_clips_per_vod": 10,
    "clip_delay_hours": 0
  }
}
```

- `twitch.channels` - List of Twitch channel logins to fetch VODs from
- `twitch.cli_path` - Path to TwitchDownloaderCLI binary
- `automation.enabled` - Run the automated download, ranking, conversion, and delivery pipeline

## Supported Formats

- **Video**: .mp4, .mkv, .webm, .mov
- **Chat**: JSON (Twitch chat-downloader format)
