# Development setup

This guide covers a new installation and refreshing an older ClipDetector checkout. The app has two processes:

- a Python 3.12 FastAPI backend on port 8000
- a Next.js frontend on port 3000

The repository root is referred to as `<project>` below.

## 1. Install prerequisites

ClipDetector expects:

- **Python 3.12** — use this exact minor version when creating the virtual environment. Do not use the macOS default `python3` without checking its version.
- **Node.js 20.9 or newer** — required by the installed Next.js version.
- **FFmpeg and FFprobe** — used for audio analysis, video streaming, and clip export.
- **TwitchDownloaderCLI** — required for Twitch VOD and chat downloads, but not for analyzing files already stored locally.

### macOS

Install the Homebrew-managed dependencies:

```bash
brew install python@3.12 node ffmpeg
```

Install TwitchDownloaderCLI using [the macOS instructions](TWITCHDOWNLOADER.md). Apple Silicon Macs must use the arm64 build.

Verify the tools before continuing:

```bash
python3.12 --version
node --version
ffmpeg -version
ffprobe -version
TwitchDownloaderCLI --version
```

The first command must report Python 3.12. Node must report 20.9 or newer.

### Windows

Install Python 3.12, Node.js 20 LTS or newer, FFmpeg, Git, and the Windows x64 TwitchDownloaderCLI release. Ensure each executable is on `PATH`, then verify them in PowerShell:

```powershell
py -3.12 --version
node --version
ffmpeg -version
ffprobe -version
TwitchDownloaderCLI --version
```

## 2. Create the backend environment

From the repository root on macOS:

```bash
cd backend
python3.12 -m venv venv
source venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m pip check
cd ..
```

On Windows PowerShell:

```powershell
cd backend
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m pip check
cd ..
```

`python -m pip check` should end with `No broken requirements found.` Using `python -m pip` ensures packages are installed into the active virtual environment instead of another Python installation.

### Refreshing an existing environment

After returning to an older checkout, activate the existing environment and reapply the pinned requirements:

```bash
cd backend
source venv/bin/activate
python --version
python -m pip install -r requirements.txt
python -m pip check
cd ..
```

The Python version should be 3.12. If it is not, rebuild the generated environment on macOS with:

```bash
cd backend
python3.12 -m venv --clear venv
source venv/bin/activate
python -m pip install -r requirements.txt
cd ..
```

If `pip check` reports that `opencv-python-headless` requires NumPy 2, remove it and check again:

```bash
python -m pip uninstall opencv-python-headless
python -m pip install -r requirements.txt
python -m pip check
```

OpenCV is not a ClipDetector dependency. It may be left in an older virtual environment from unrelated experimentation. ClipDetector pins NumPy 1.26.4 for compatibility with its audio-analysis dependencies.

## 3. Install frontend dependencies

From the repository root:

```bash
cd frontend
npm ci
npm run build
cd ..
```

Use `npm ci` for an existing checkout because it reproduces `package-lock.json` and removes stale packages. Use `npm install` only when intentionally changing frontend dependencies.

## 4. Create local configuration

Copy both tracked examples from the repository root:

```bash
cp backend/.env.example backend/.env
cp config.example.json config.json
```

Windows PowerShell equivalents:

```powershell
Copy-Item backend/.env.example backend/.env
Copy-Item config.example.json config.json
```

Edit `backend/.env` and replace the placeholder values:

```dotenv
TWITCH_CLIENT_ID=your_client_id
TWITCH_CLIENT_SECRET=your_client_secret
ANTHROPIC_API_KEY=your_api_key
```

Twitch credentials are needed for fetching the VOD list and automation. The Anthropic key is needed by the automated clip-ranking pipeline.

- Create Twitch application credentials in the [Twitch developer console](https://dev.twitch.tv/console).
- Create the Anthropic key in the [Anthropic console](https://console.anthropic.com/).

Edit `config.json`:

```json
{
  "twitch": {
    "channels": ["channel_one", "channel_two"],
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

On macOS, `command -v TwitchDownloaderCLI` prints the absolute path if one is needed. A typical value is `/usr/local/bin/TwitchDownloaderCLI`. In a Windows JSON string, escape backslashes, for example `C:\\Tools\\TwitchDownloaderCLI.exe`.

Keep automation disabled for the first startup. When enabled, the backend runs the automation pipeline immediately at startup and then at the configured interval; it may fetch, download, analyze, and deliver clips.

Both `backend/.env` and `config.json` are local-only and ignored by Git.

## 5. Start and verify

On macOS, start both processes from the repository root:

```bash
./start.sh
```

On Windows, use two PowerShell windows.

Backend:

```powershell
cd backend
.\venv\Scripts\Activate.ps1
uvicorn main:app --reload
```

Frontend:

```powershell
cd frontend
npm run dev
```

Verify the backend in another terminal:

```bash
curl http://localhost:8000/health
```

The expected response is:

```json
{"status":"healthy","service":"clipdetector-api"}
```

Open <http://localhost:3000>. Stop both macOS processes by pressing Control-C in the terminal running `start.sh`.

## Running one service at a time

Backend on macOS:

```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload
```

Frontend:

```bash
cd frontend
npm run dev
```

Always launch the backend from the `backend` directory so its imports and `.env` file resolve consistently.

## Common problems

### `python3` reports 3.13 or newer

That may be the current system default. Create the environment with `python3.12 -m venv venv`; after activation, `python --version` should report 3.12.

### Port 3000 or 8000 is already in use

On macOS, find the old process with:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

Stop the identified development process, then run `./start.sh` again.

### TwitchDownloaderCLI is blocked on macOS

Use **System Settings → Privacy & Security → Open Anyway**, then rerun `TwitchDownloaderCLI --version`. See [the TwitchDownloaderCLI guide](TWITCHDOWNLOADER.md).

### Speech analysis is slow on its first run

Faster Whisper downloads its selected model the first time it is used. Later runs reuse the local model cache.

### Frontend checks fail

Run `npm ci` to restore the committed dependency set, then retry `npm run lint` and `npm run build`. Both checks should complete without warnings or errors.

## Local data

Runtime files are kept under `data/` and are intentionally ignored by Git:

- `data/vods/` — downloaded or manually added videos
- `data/chats/` — downloaded or manually added chat JSON
- `data/clips/` — exported clips
- `data/twitch/` — cached Twitch metadata

Large VODs and generated clips do not need to be recreated when Python or frontend dependencies are refreshed.
