# Pi VOD Notifier

Get Discord DMs when your favorite Twitch streamers publish new VODs. Designed to run on a Raspberry Pi.

## How It Works

1. Connects to Twitch EventSub WebSocket
2. Listens for `stream.offline` events from configured channels
3. When a stream ends, polls for the new VOD (handles delayed publishers like CaseOh)
4. Sends you a Discord DM with VOD details when detected
5. Tracks known VODs to prevent duplicate notifications

## Setup

### 1. Twitch App

1. Go to [Twitch Developer Console](https://dev.twitch.tv/console)
2. Create a new application (any name, any category)
3. Copy your **Client ID** and generate a **Client Secret**

### 2. Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** and name it (e.g., "ClipDetector Notifier")
3. Go to **Bot** tab and click **Add Bot**
4. Click **Reset Token** and copy the token
5. Under **Privileged Gateway Intents**, enable **Message Content Intent**
6. Get your Discord User ID:
   - In Discord, go to **Settings > Advanced > Enable Developer Mode**
   - Right-click your name anywhere and click **Copy User ID**
7. Invite the bot to a server you're both in (required for DMs):
   - Go to **OAuth2 > URL Generator**
   - Select **bot** scope (no permissions needed)
   - Open the generated URL and add bot to any server

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
TWITCH_CLIENT_ID=your_client_id
TWITCH_CLIENT_SECRET=your_client_secret
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_USER_ID=your_user_id
TWITCH_CHANNELS=jynxzi,caseoh_

# Optional: Trigger ClipDetector pipeline on new VODs
CLIPDETECTOR_URL=http://192.168.x.x:8000
```

### 4. Run Locally

```bash
bun run start
```

## Deploy to Raspberry Pi

1. Build for Node.js:
   ```bash
   bun run build:node
   ```

2. Transfer to Pi via SFTP:
   ```bash
   sftp pi@asherpi.local
   put notifier.js
   put .env
   ```

3. On the Pi, install Node.js (if needed):
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
   sudo apt-get install -y nodejs
   ```

4. Run:
   ```bash
   set -a && source .env && set +a && node notifier.js
   ```

   > **Note:** This uses shell sourcing for compatibility with older Node.js versions that don't support `--env-file`.

### Run as a Service (Optional)

Create `/etc/systemd/system/clipdetector-notifier.service`:

```ini
[Unit]
Description=ClipDetector VOD Notifier
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi
ExecStart=/bin/bash -c 'set -a && source /home/pi/.env && set +a && exec node /home/pi/notifier.js'
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then enable and start:

```bash
sudo systemctl enable clipdetector-notifier
sudo systemctl start clipdetector-notifier
```

## Quick Reference

### Service Commands

```bash
sudo systemctl status clipdetector-notifier   # Check status
sudo systemctl restart clipdetector-notifier  # Restart service
sudo systemctl stop clipdetector-notifier     # Stop service
```

### View Logs

```bash
journalctl -u clipdetector-notifier -f        # Follow logs (live)
journalctl -u clipdetector-notifier -n 50     # Last 50 lines
```

### SSH to Pi

```bash
ssh pi@asherpi.local
```

## Data Storage

Known VOD IDs are stored in `~/.clipdetector-notifier/vods.json` to prevent duplicate notifications across restarts.
