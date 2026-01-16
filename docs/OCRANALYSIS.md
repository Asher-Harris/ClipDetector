# Feature Spec: OCR Analyzer (Game Event Detection)

## Overview

Add a new analyzer module (`backend/analyzers/ocr.py`) that samples frames from the VOD and uses OCR to detect on-screen game events like "VICTORY", "ELIMINATED", "YOU DIED", kill feeds, and other text-based game UI elements.

## Goals

1. **Frame Sampling**: Efficiently sample frames from the VOD at regular intervals
2. **Text Detection**: Extract visible text from game UI regions
3. **Event Matching**: Identify clip-worthy game events based on detected text
4. **Flexibility**: Support different games through configurable keyword sets

## Why This Matters

This catches moments that audio and chat might miss:
- Clutch victories where the streamer stays calm
- Kill streaks when chat is slow or streamer is focused
- Achievements, unlocks, world records
- Death screens (often funny/rage moments)
- Competitive game results (rankings, scores)

For variety streamers, OCR adapts to whatever game is being played as long as the game has text-based UI feedback.

## Suggested Dependencies

```
easyocr       # Simpler API, good accuracy
# OR
paddleocr    # Faster, slightly more setup
```

Also needs:
```
opencv-python  # Already likely installed, for frame extraction
```

**Recommendation**: Start with EasyOCR for simplicity. Switch to PaddleOCR if performance is an issue.

## API Design

Should follow the existing pattern in `audio.py` and `chat.py`.

### Endpoint

```
POST /api/analyze/ocr
```

### Request Body

```json
{
  "file_path": "vods/my_stream.mp4",
  "sample_interval": 1.0,
  "game_preset": "general",
  "custom_keywords": ["WORLD RECORD", "NEW BEST"]
}
```

**Parameters:**
- `file_path` (required): Path to video file relative to `/data` folder
- `sample_interval` (optional, default 1.0): Seconds between frame samples
- `game_preset` (optional, default "general"): Predefined keyword set for specific games
- `custom_keywords` (optional): Additional keywords to detect
- `regions` (optional): Specific screen regions to scan (see below)

### Response

```json
{
  "file_path": "vods/my_stream.mp4",
  "moments": [
    {
      "timestamp": 1823.0,
      "intensity": 2.0,
      "duration": 2.0,
      "moment_type": "game_event",
      "details": {
        "detected_text": "VICTORY ROYALE",
        "matched_keyword": "VICTORY",
        "confidence": 0.94,
        "category": "win"
      }
    },
    {
      "timestamp": 542.5,
      "intensity": 1.5,
      "duration": 1.0,
      "moment_type": "game_event",
      "details": {
        "detected_text": "DOUBLE KILL",
        "matched_keyword": "DOUBLE KILL",
        "confidence": 0.87,
        "category": "kill_streak"
      }
    }
  ],
  "total_moments": 2,
  "frames_processed": 3600,
  "config": {
    "sample_interval": 1.0,
    "game_preset": "general"
  }
}
```

## Game Presets

Predefined keyword sets for common games/genres. User can select a preset or use "general" for variety content.

### General (default)
Catches common patterns across many games:

**Win/Victory (intensity: 2.0, category: "win"):**
- "VICTORY", "WINNER", "YOU WIN", "YOU WON"
- "CHAMPION", "#1", "1ST PLACE", "FIRST PLACE"
- "COMPLETED", "FINISHED", "SUCCESS"
- "WORLD RECORD", "NEW RECORD", "PERSONAL BEST", "NEW BEST", "PB"

**Death/Loss (intensity: 1.5, category: "death"):**
- "YOU DIED", "DEAD", "DEATH"
- "WASTED", "BUSTED"
- "GAME OVER", "DEFEATED", "ELIMINATED"
- "YOU LOSE", "LOST"
- "RETRY", "TRY AGAIN", "RESPAWN"

**Kill Streaks (intensity: 1.5-2.0, category: "kill_streak"):**
- "KILL", "ELIMINATED"
- "DOUBLE KILL", "TRIPLE KILL", "QUADRA", "PENTA"
- "MULTI KILL", "MEGA KILL", "ULTRA KILL"
- "KILLING SPREE", "RAMPAGE", "UNSTOPPABLE"
- "HEADSHOT", "ONE SHOT"
- "ACE", "CLUTCH"

**Achievement (intensity: 1.5, category: "achievement"):**
- "ACHIEVEMENT", "TROPHY", "UNLOCKED"
- "LEVEL UP", "RANK UP"
- "NEW HIGH SCORE", "HIGH SCORE"

### Battle Royale Preset
Fortnite, Apex, PUBG, Warzone:
- General preset keywords PLUS:
- "VICTORY ROYALE", "WINNER WINNER", "YOU ARE THE CHAMPION"
- "KNOCKED", "DOWNED", "THIRSTED"
- "SQUAD WIPE", "TEAM WIPE"
- "TOP 10", "TOP 5", "TOP 3"

### FPS Preset
Valorant, CS2, Overwatch, COD:
- General preset keywords PLUS:
- "ROUND WIN", "ROUND LOST"
- "DEFUSE", "PLANTED", "SPIKE"
- "PLAY OF THE GAME", "POTG"
- "MVP", "MATCH MVP"
- "FLAWLESS"

### Souls-like Preset
Dark Souls, Elden Ring, Sekiro:
- "YOU DIED" (high intensity: 2.0)
- "ENEMY FELLED", "GREAT ENEMY FELLED"
- "HEIR OF CHAOS", "LORD OF CINDER"
- "BOSS" (context-dependent)
- "BONFIRE LIT", "GRACE DISCOVERED"

### Roguelike Preset
Hades, Dead Cells, Binding of Isaac, Balatro:
- "RUN COMPLETE", "ESCAPE"
- "DEATH", "DEAD"
- "NEW UNLOCK", "UNLOCKED"
- "FLOOR", "BIOME"

## Screen Region Configuration

OCR is expensive. To improve performance, allow specifying regions of the screen to scan:

```json
{
  "regions": [
    {"name": "center", "x": 0.3, "y": 0.3, "width": 0.4, "height": 0.4},
    {"name": "killfeed", "x": 0.7, "y": 0.0, "width": 0.3, "height": 0.3},
    {"name": "bottom", "x": 0.0, "y": 0.8, "width": 1.0, "height": 0.2}
  ]
}
```

Coordinates are normalized (0.0 to 1.0) to handle different resolutions.

**Default regions** (if not specified):
1. Center region (40% of screen, centered) - catches victory screens, death screens
2. Top-right (30% width, 30% height) - catches kill feeds in most games
3. Bottom strip (full width, 20% height) - catches UI notifications

Or scan full frame if no regions specified (slower but catches everything).

## Implementation Notes

### Frame Extraction

Use OpenCV to extract frames at the sample interval:

```python
import cv2

cap = cv2.VideoCapture(video_path)
fps = cap.get(cv2.CAP_PROP_FPS)
frame_interval = int(fps * sample_interval)

frame_count = 0
while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break
    
    if frame_count % frame_interval == 0:
        timestamp = frame_count / fps
        # Process frame with OCR
        
    frame_count += 1
```

### OCR Processing

**EasyOCR example:**
```python
import easyocr

reader = easyocr.Reader(['en'])

# Full frame
results = reader.readtext(frame)

# Results format: [(bbox, text, confidence), ...]
for (bbox, text, confidence) in results:
    if confidence > 0.5:  # Filter low confidence
        # Check against keywords
        pass
```

**PaddleOCR example:**
```python
from paddleocr import PaddleOCR

ocr = PaddleOCR(use_angle_cls=True, lang='en')
result = ocr.ocr(frame, cls=True)

for line in result[0]:
    text = line[1][0]
    confidence = line[1][1]
```

### Keyword Matching

- Case insensitive matching
- Handle OCR errors with fuzzy matching (optional, e.g., "V1CTORY" → "VICTORY")
- Combine nearby text detections (same frame) that form phrases
- Debounce: same keyword detected within 3-5 seconds = single moment

### Performance Optimization

OCR is the slowest part. Strategies to improve:

1. **Reduce sample rate**: 1 frame per second is usually enough; game events display for 2-5 seconds
2. **Region-based scanning**: Only scan relevant screen areas
3. **Resolution downscaling**: Resize frames to 720p or lower before OCR
4. **Skip similar frames**: Use frame differencing to skip frames with no significant change
5. **GPU acceleration**: Both EasyOCR and PaddleOCR support GPU

```python
# EasyOCR with GPU
reader = easyocr.Reader(['en'], gpu=True)

# PaddleOCR with GPU
ocr = PaddleOCR(use_gpu=True)
```

### Edge Cases

- Stylized game fonts may not OCR well (configure confidence threshold)
- Webcam overlay might contain text (exclude webcam region or handle separately)
- Non-English games (specify language parameter)
- Games with minimal text UI (OCR won't help much, rely on other signals)

## Integration with Fusion

Update `fusion.py` to incorporate OCR moments:

Suggested weights by category:
- `win`: base weight 2.0 × intensity (very strong signal)
- `death`: base weight 1.5 × intensity (good signal, often funny/emotional)
- `kill_streak`: base weight 1.5 × intensity
- `achievement`: base weight 1.5 × intensity

OCR events should heavily synergize with other signals:
- "VICTORY" + chat explosion + audio spike = extremely high confidence clip

## Handling Webcam Overlay

Since the webcam position can vary:

**Option 1**: Ignore it — if webcam has text (rare), it'll just add noise
**Option 2**: Let user configure webcam exclusion region  
**Option 3**: Face detection to auto-find webcam region and exclude

Recommend Option 1 for now; webcam rarely has text that matches game event keywords.

## Future Enhancements (Out of Scope for Now)

- Auto-detect game from title screen text
- Learn game-specific fonts for better accuracy
- Track scores/numbers (not just events)
- Detect specific character/item names
- Create per-game tuned models

## Files to Create/Modify

1. **Create**: `backend/analyzers/ocr.py` - Main analyzer module
2. **Create**: `backend/analyzers/game_presets.py` - Keyword preset definitions (or include in ocr.py)
3. **Modify**: `backend/main.py` - Add `/api/analyze/ocr` endpoint
4. **Modify**: `backend/analyzers/fusion.py` - Incorporate OCR signals
5. **Modify**: `backend/requirements.txt` - Add `easyocr` (and `opencv-python` if not present)

## Testing

1. Test frame extraction at various intervals
2. Test OCR accuracy on different games (grab some sample frames)
3. Verify keyword matching with various capitalizations
4. Test debouncing (same event shouldn't create duplicate moments)
5. Benchmark performance: frames per second on M2 vs GPU

### Test Cases to Try

- Fortnite Victory Royale screen
- Dark Souls "YOU DIED" screen
- Valorant round win/loss
- Any game with a kill feed
- Speedrun timer with "NEW BEST" or "PB"