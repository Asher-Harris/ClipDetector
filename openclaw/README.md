# OpenClaw Integration (Optional)

OpenClaw is **not required** for the clip pipeline. The backend delivers clips directly to Telegram after processing — no intermediary needed.

OpenClaw may be useful in the future for chatbot features (e.g. "get me clips from last night's stream"), but is not part of the current automated flow.

## Current Flow (without OpenClaw)

1. Pi notifier detects a new VOD and POSTs to ClipDetector backend (`/api/automation/run`)
2. Backend pipeline downloads top clips, converts to vertical format
3. Backend delivers ready clips to Telegram via Bot API
4. Clips are marked delivered and cleaned up from disk

## Telegram Bot Setup

If you need to set up the Telegram bot for clip delivery:

1. Open Telegram and message `@BotFather`
2. Send `/newbot`, follow the prompts, and save the bot token
3. Create a Telegram group or channel for clips, then add your bot to it
4. Get the chat ID by forwarding any message from that group to `@userinfobot`
5. If using a group: go back to `@BotFather`, send `/setprivacy`, select your bot, and choose **Disable** (so the bot can see messages). Then remove and re-add the bot to the group for the change to take effect

Add to `backend/.env`:

```
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

## WSL Setup Guide

If setting up ClipDetector from scratch on Windows, see below for prerequisites.

### WSL2

```powershell
wsl --install
```

### Python 3.12

Python 3.13+ won't work — `onnxruntime` (required by faster-whisper) doesn't have wheels for it yet.

```bash
sudo apt update
sudo apt install software-properties-common
sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt install python3.12 python3.12-venv python3.12-dev
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

## OpenClaw Setup (Future Use)

If you want to set up OpenClaw for chatbot features later:

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
openclaw onboard --install-daemon
```

> **Note:** `openclaw/cron-example.json` is kept for reference if you want polling-based delivery via OpenClaw instead of direct Telegram delivery.
