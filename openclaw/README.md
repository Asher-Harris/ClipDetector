# OpenClaw Integration

ClipDetector exposes a simple HTTP API so OpenClaw can retrieve vertical clips and mark them as delivered.

## Prerequisites

- ClipDetector must be running (`./start.sh` from the project root)
- Both services run on the same machine (OpenClaw calls `localhost:8000`)

## Workflow

OpenClaw's cron job should follow this sequence on each run:

1. **Trigger the pipeline** (optional — the scheduler already runs every 2 hours automatically):
   ```
   POST http://localhost:8000/api/automation/run
   ```
   Returns immediately; pipeline runs in the background.

2. **Fetch ready clips**:
   ```
   GET http://localhost:8000/api/automation/ready-clips
   ```
   Returns a list of vertical clips that have been processed but not yet delivered:
   ```json
   [
     {
       "filename": "AbCdEfGh_vertical.mp4",
       "channel": "jynxzi",
       "vod_title": "ranked grind day 14",
       "file_size": 52428800,
       "url": "http://localhost:8000/data/clips/AbCdEfGh_vertical.mp4",
       "created_at": "2024-01-15T12:34:56+00:00"
     }
   ]
   ```

3. **Download each clip** via the `url` field (supports HTTP Range for efficient streaming).

4. **Send to Telegram** via the Bot API.

5. **Mark as delivered** so it won't appear in future `ready-clips` responses:
   ```
   POST http://localhost:8000/api/automation/clips/{filename}/delivered
   ```

## Status endpoint

```
GET http://localhost:8000/api/automation/status
```
Returns scheduler state and recent pipeline results.

## Cron example

See `cron-example.json` for a copy-paste cron job definition.
