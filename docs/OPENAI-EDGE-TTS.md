# OpenAI Edge TTS Setup Reference

## Repository
https://github.com/travisvn/openai-edge-tts

## What It Is

OpenAI-Edge-TTS is a free, local text-to-speech API that mimics OpenAI's TTS endpoint using Microsoft Edge's online TTS service. It provides an OpenAI-compatible API for generating speech without any costs.

## Installation (Docker)

**Basic:**
```bash
docker run -d -p 5050:5050 travisvn/openai-edge-tts:latest
```

**With FFmpeg (for audio format conversion):**
```bash
docker run -d -p 5050:5050 travisvn/openai-edge-tts:latest-ffmpeg
```

**Verify it's running:**
```bash
curl http://localhost:5050/v1/models
```

## Voice Options

ClipDetector uses these voices:
- `en-GB-RyanNeural` - British male (most natural, recommended)
- `en-US-AndrewNeural` - American male

Other available voices include any valid edge-tts voice identifier (e.g., `en-US-AvaNeural`, `en-US-GuyNeural`).

## API Endpoint

**POST `/v1/audio/speech`**

```bash
curl -X POST http://localhost:5050/v1/audio/speech \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_api_key_here" \
  -d '{
    "input": "Hello, welcome to the stream!",
    "voice": "en-GB-RyanNeural",
    "response_format": "mp3",
    "speed": 1.1
  }' --output output.mp3
```

**Parameters:**
- `input` (required): Text to convert (max 4096 characters)
- `voice`: Voice identifier (default varies)
- `response_format`: mp3, opus, aac, flac, wav, or pcm
- `speed`: Playback rate 0.25 to 4.0 (default 1.0)

## Configuration (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY` | - | Authentication key (optional) |
| `PORT` | 5050 | Server port |
| `DEFAULT_VOICE` | - | Default voice selection |
| `DEFAULT_RESPONSE_FORMAT` | mp3 | Audio output format |
| `DEFAULT_SPEED` | 1.0 | Default playback speed |
| `REQUIRE_API_KEY` | false | Require authentication |

**Example with custom config:**
```bash
docker run -d -p 5050:5050 \
  -e DEFAULT_VOICE=en-GB-RyanNeural \
  -e DEFAULT_SPEED=1.1 \
  travisvn/openai-edge-tts:latest
```

## Example Usage with ClipDetector

**Direct API test:**
```bash
curl -X POST http://localhost:5050/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Check out this amazing play!",
    "voice": "en-GB-RyanNeural",
    "response_format": "mp3",
    "speed": 1.1
  }' --output ~/Downloads/intro.mp3
```

**Through ClipDetector backend:**
```bash
curl -X POST http://localhost:8000/api/tts/preview \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Check out this amazing play!",
    "voice": "en-GB-RyanNeural",
    "speed": 1.1
  }' --output preview.mp3
```

## Troubleshooting

**Container not starting:**
```bash
docker logs $(docker ps -q --filter ancestor=travisvn/openai-edge-tts)
```

**Port already in use:**
```bash
docker run -d -p 5051:5050 travisvn/openai-edge-tts:latest
```
Then update `TTS_API_URL` in `backend/main.py` to use port 5051.

**Stop the container:**
```bash
docker stop $(docker ps -q --filter ancestor=travisvn/openai-edge-tts)
```

## Useful Commands

```bash
# Check if running
docker ps | grep openai-edge-tts

# View logs
docker logs -f $(docker ps -q --filter ancestor=travisvn/openai-edge-tts)

# Restart container
docker restart $(docker ps -q --filter ancestor=travisvn/openai-edge-tts)

# List available voices (via edge-tts CLI)
docker exec -it $(docker ps -q --filter ancestor=travisvn/openai-edge-tts) edge-tts --list-voices | grep en-
```
