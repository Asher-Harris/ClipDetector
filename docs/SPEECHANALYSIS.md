# Feature Spec: Speech Analyzer (Transcription + Keyword Detection)

## Overview

Add a new analyzer module (`backend/analyzers/speech.py`) that transcribes VOD audio using OpenAI's Whisper model and detects clip-worthy moments based on what the streamer is saying.

## Goals

1. **Transcription**: Convert VOD audio to timestamped text segments
2. **Keyword Detection**: Identify moments where the streamer says excitement/reaction phrases
3. **Speech Rate Analysis**: Detect when the streamer is talking unusually fast (often indicates excitement)
4. **Integration**: Output should match the existing analyzer pattern so fusion.py can incorporate speech signals

## Why This Matters

Audio spikes catch when the streamer gets loud, but miss moments where they:
- Say something exciting at normal volume ("I can't believe that just happened")
- React with specific phrases ("NO WAY", "LET'S GO", "holy shit")
- Talk rapidly due to excitement without necessarily being louder

Chat catches audience reactions but has latency and may be quiet for smaller streamers.

Transcription fills these gaps and provides bonus value for clip metadata (auto-titles, searchability).

## Suggested Dependencies

```
openai-whisper  # or faster-whisper for better performance
```

Both work well on Apple Silicon (M2) via MPS acceleration. The `base` or `small` model should be sufficient and runs roughly real-time on M2.

Alternative: `faster-whisper` is ~4x faster and uses less memory via CTranslate2 optimization. Consider this if processing speed becomes an issue.

## API Design

Should follow the existing pattern in `audio.py` and `chat.py`.

### Endpoint

```
POST /api/analyze/speech
```

### Request Body

```json
{
  "file_path": "vods/my_stream.mp4",
  "model_size": "base",
  "language": "en"
}
```

**Parameters:**
- `file_path` (required): Path to video file relative to `/data` folder
- `model_size` (optional, default "base"): Whisper model size (tiny, base, small, medium, large)
- `language` (optional, default "en"): Language code, or null for auto-detection

### Response

```json
{
  "file_path": "vods/my_stream.mp4",
  "moments": [
    {
      "timestamp": 125.5,
      "intensity": 1.8,
      "duration": 3.0,
      "moment_type": "keyword_match",
      "details": {
        "text": "oh my god no way",
        "matched_keywords": ["oh my god", "no way"],
        "keyword_score": 2.0
      }
    },
    {
      "timestamp": 342.0,
      "intensity": 1.3,
      "duration": 5.0,
      "moment_type": "speech_rate_spike",
      "details": {
        "text": "and then I just ran in and killed all three of them and got out with like one HP",
        "words_per_minute": 210,
        "baseline_wpm": 140
      }
    }
  ],
  "total_moments": 2,
  "transcript_segments": [
    {
      "start": 0.0,
      "end": 4.5,
      "text": "Hey what's up everyone welcome back to the stream"
    }
    // ... full transcript for potential future use
  ],
  "config": {
    "model_size": "base",
    "language": "en"
  }
}
```

## Keyword Detection

### Default Keyword List

Should include a configurable list of excitement/reaction phrases. Suggested defaults:

**High intensity (score: 2.0):**
- "oh my god", "holy shit", "holy fuck", "what the fuck", "no fucking way"
- "let's go", "let's fucking go", "lets go"
- "no way", "no way no way"
- "i can't believe", "are you kidding", "are you serious"
- "that was insane", "that was crazy"

**Medium intensity (score: 1.5):**
- "wow", "dude", "bro"
- "finally", "yes yes yes"
- "clutch", "huge", "massive"
- "gg", "good game"
- "rip", "we died", "i died"

**Low intensity (score: 1.0):**
- "nice", "sick", "cool"
- "okay okay", "alright"
- "here we go"

### Matching Logic

- Case insensitive
- Match partial phrases within segments
- If multiple keywords in same segment, sum scores (with diminishing returns, e.g., `total = sum * 0.8`)
- Consider proximity: multiple keywords within 5 seconds = boost

## Speech Rate Analysis

Calculate words per minute (WPM) for each segment:
- Track rolling baseline WPM (average over last 60 seconds of speech)
- Flag segments where WPM exceeds baseline by 1.5x+ as `speech_rate_spike`
- Intensity = ratio of current WPM to baseline (e.g., 210/140 = 1.5)

Typical speaking rates:
- Slow/relaxed: 100-120 WPM
- Normal: 130-150 WPM  
- Fast/excited: 160-200+ WPM

## Implementation Notes

### Audio Extraction

Whisper can work directly with video files, but extracting audio first may be cleaner:

```python
# Option 1: Let Whisper handle it directly
result = model.transcribe("video.mp4")

# Option 2: Extract audio first with ffmpeg
# ffmpeg -i video.mp4 -vn -acodec pcm_s16le -ar 16000 -ac 1 audio.wav
```

### Segment Handling

Whisper returns segments with start/end times. Use these directly for timestamp alignment.

```python
result = model.transcribe(audio_path)
for segment in result["segments"]:
    start = segment["start"]
    end = segment["end"]
    text = segment["text"]
```

### Performance Considerations

- Whisper `base` model: ~1GB VRAM, roughly real-time on M2
- Whisper `small` model: ~2GB VRAM, better accuracy, ~0.5x real-time on M2
- For 3-hour VOD: expect 3-6 hours processing time on CPU, 30-60 min on GPU/M2

Consider adding progress feedback or chunked processing for long VODs.

### Error Handling

- Handle videos with no audio track
- Handle audio with no speech detected
- Handle Whisper model download on first run (happens automatically but takes time)

## Integration with Fusion

Update `fusion.py` to incorporate speech moments:

Suggested weights:
- `keyword_match`: base weight 1.5 × intensity (strong signal)
- `speech_rate_spike`: base weight 1.0 × intensity (supporting signal)

Speech signals should synergize with audio spikes (streamer is loud AND saying "holy shit" = very high confidence).

## Future Enhancements (Out of Scope for Now)

- Profanity density tracking
- Sentiment analysis on transcribed text
- Speaker diarization (if multiple people talking)
- Clip title generation from transcript context
- Searchable transcript database

## Files to Create/Modify

1. **Create**: `backend/analyzers/speech.py` - Main analyzer module
2. **Modify**: `backend/main.py` - Add `/api/analyze/speech` endpoint
3. **Modify**: `backend/analyzers/fusion.py` - Incorporate speech signals
4. **Modify**: `backend/requirements.txt` - Add `openai-whisper` or `faster-whisper`

## Testing

Test with a short clip (1-2 minutes) first before running on full VODs:
- Verify transcription accuracy
- Verify timestamp alignment
- Verify keyword detection triggers on expected phrases
- Verify speech rate calculation is reasonable