# OpenClaw Integration

Complete guide to setting up ClipDetector + OpenClaw from scratch on a Windows laptop using WSL. By the end, the Pi notifier will trigger the clip pipeline via webhook whenever a VOD is detected, automatically delivering vertical clips to Telegram.

## 0. WSL Setup (Windows)

Everything runs inside WSL2. Open PowerShell as Administrator:

```powershell
wsl --install
```

Restart when prompted. Ubuntu installs by default — launch it from the Start menu and create a Unix username/password. All commands below run inside that WSL terminal.

## 1. Prerequisites

### Python 3.12

Python 3.13+ won't work — `onnxruntime` (required by faster-whisper) doesn't have wheels for it yet.

```bash
sudo apt update
sudo apt install software-properties-common
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt install python3.12 python3.12-venv python3.12-dev
```

### Node.js 22+

OpenClaw requires Node 22+. Install via nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
```

### FFmpeg

```bash
sudo apt install ffmpeg
```

### TwitchDownloaderCLI

Download the Linux x64 binary from [GitHub releases](https://github.com/lay295/TwitchDownloader/releases), then:

```bash
chmod +x TwitchDownloaderCLI
sudo mv TwitchDownloaderCLI /usr/local/bin/
```

## 2. Clone & Set Up ClipDetector

```bash
git clone git@github.com:Asher-Harris/ClipDetector.git
cd ClipDetector
```

### Backend

```bash
cd backend
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Copy the env file and fill in your credentials:

```bash
cp .env.example .env
```

Edit `backend/.env` with your values:

```
TWITCH_CLIENT_ID=your_client_id
TWITCH_CLIENT_SECRET=your_client_secret
ANTHROPIC_API_KEY=your_api_key
```

Get Twitch credentials from https://dev.twitch.tv/console. Get your Anthropic API key from https://console.anthropic.com.

### Frontend

```bash
cd ../frontend
npm install
```

### Configuration

Edit `config.json` in the project root to set your Twitch channels and automation preferences:

```json
{
  "twitch": {
    "channels": ["your_channel"],
    "cli_path": "/usr/local/bin/TwitchDownloaderCLI"
  },
  "automation": {
    "enabled": true,
    "check_interval_hours": 2,
    "top_clips_per_vod": 1,
    "clip_delay_hours": 0
  }
}
```

### Start & Verify

```bash
cd /path/to/ClipDetector
./start.sh
```

Backend runs on `:8000`, frontend on `:3000`. Verify with:

```bash
curl http://localhost:8000/api/config
```

## 3. Install OpenClaw

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```

Run the onboarding wizard:

```bash
openclaw onboard --install-daemon
```

Verify everything is working:

```bash
openclaw doctor
openclaw status
```

## 4. Set Up Telegram Bot

1. Open Telegram and message `@BotFather`
2. Send `/newbot`, follow the prompts, and save the bot token
3. Create a Telegram group or channel for clips, then add your bot to it
4. Get the chat ID by forwarding any message from that group to `@userinfobot`
5. If using a group: go back to `@BotFather`, send `/setprivacy`, select your bot, and choose **Disable** (so the bot can see messages). Then remove and re-add the bot to the group for the change to take effect

Configure OpenClaw with your Telegram credentials — edit `~/.openclaw/openclaw.json`:

```json5
{
  channels: {
    telegram: {
      enabled: true,
      botToken: "<token from BotFather>",
      groups: {
        "<chat_id>": { requireMention: false }
      }
    }
  }
}
```

Start the gateway and approve pairing:

```bash
openclaw gateway
openclaw pairing list telegram
openclaw pairing approve telegram <CODE>
```

## 5. Enable Webhook

The Pi notifier triggers the clip pipeline automatically when a VOD is detected — no cron job needed.

Configure hooks in `~/.openclaw/openclaw.json`:

```json5
{
  hooks: {
    enabled: true,
    token: "your_shared_secret"
  }
}
```

Use the same token value in the Pi notifier's `OPENCLAW_WEBHOOK_TOKEN` env var.

The gateway must be reachable from the Pi (same LAN, port 18789). Start it with:

```bash
openclaw gateway
```

When a VOD is detected, the Pi POSTs to `/hooks/agent` which triggers an agent that:

1. Runs the ClipDetector pipeline
2. Polls until processing completes
3. Sends each ready clip to Telegram
4. Marks clips as delivered and cleans up disk space

> **Note:** `openclaw/cron-example.json` is kept for reference if you prefer polling-based delivery instead.

## 6. Verification

1. Ensure ClipDetector is running (`./start.sh`)
2. Ensure the OpenClaw gateway is running with hooks enabled (`openclaw gateway`)
3. Test the webhook manually from the Pi (or any device on the LAN):
   ```bash
   curl -X POST http://<laptop-ip>:18789/hooks/agent \
     -H 'Authorization: Bearer <token>' \
     -H 'Content-Type: application/json' \
     -d '{"message":"Trigger ClipDetector pipeline test","name":"ClipDetector","deliver":false,"timeoutSeconds":60}'
   ```
   Should return `202 Accepted`.
4. Rebuild and redeploy pi-notifier: `bun run build:node`, transfer `notifier.js` to Pi
5. End-to-end: wait for a stream to end, confirm:
   - Discord DM arrives
   - Pipeline triggers on laptop (check `curl http://localhost:8000/api/automation/status`)
   - Clips arrive in Telegram

## 7. API Reference

### `GET /api/automation/ready-clips`

Returns vertical clips that have been processed but not yet delivered:

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

### `POST /api/automation/clips/{filename}/delivered`

Mark a clip as delivered so it won't appear in future `ready-clips` responses.

### `POST /api/automation/cleanup-delivered`

Delete delivered clip files from disk (both `_vertical.mp4` and original `.mp4`). Does not modify VOD storage records — only removes files to free disk space.

### `GET /api/automation/status`

Returns scheduler state and recent pipeline results.
