# TwitchDownloader Setup Reference

## Repository
https://github.com/lay295/TwitchDownloader

## Installation (macOS Apple Silicon)

- Download the `arm64` CLI binary from the [TwitchDownloader releases](https://github.com/lay295/TwitchDownloader/releases). Do not use the x64 build on an Apple Silicon Mac.
- Make the downloaded file executable: `chmod +x TwitchDownloaderCLI`.
- Run it once. If macOS blocks it, approve it in **System Settings → Privacy & Security → Open Anyway**.
- Move it to a directory on `PATH`:
  ```bash
  sudo mv TwitchDownloaderCLI /usr/local/bin/
  ```
- Verify the installation:
  ```bash
  TwitchDownloaderCLI --version
  command -v TwitchDownloaderCLI
  ```
- Put the path printed by `command -v` in the root `config.json` as `twitch.cli_path`.

## Dependencies

- **FFmpeg** (installed via Homebrew):
  ```bash
  brew install ffmpeg
  ```

## Common Commands

**Download a VOD:**
```bash
TwitchDownloaderCLI videodownload --id <vod-id> -o output.mp4
```

**Download chat:**
```bash
TwitchDownloaderCLI chatdownload --id <vod-id> -o chat.json
```

**Download a clip:**
```bash
TwitchDownloaderCLI clipdownload --id <clip-slug> -o clip.mp4
```

**Render chat as video overlay:**
```bash
TwitchDownloaderCLI chatrender -i chat.json -o chat_overlay.mp4
```

## Useful Flags

- `-q 1080p60` — specify video quality
- `--help` — see all options for any command

## Example Workflow

```bash
# Download VOD and chat for a stream
TwitchDownloaderCLI videodownload --id 2670756622 -o stream.mp4
TwitchDownloaderCLI chatdownload --id 2670756622 -o chat.json
```
