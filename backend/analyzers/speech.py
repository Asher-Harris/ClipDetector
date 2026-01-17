import re
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from faster_whisper import WhisperModel


@dataclass
class SpeechConfig:
    model_size: str = "base"
    language: str = "en"
    speech_rate_threshold: float = 1.5
    baseline_window: float = 60.0
    min_speech_for_baseline: float = 30.0
    min_words_per_segment: int = 3


@dataclass
class SpeechMoment:
    timestamp: float
    intensity: float
    duration: float
    moment_type: str
    details: dict = field(default_factory=dict)


@dataclass
class TranscriptSegment:
    start: float
    end: float
    text: str


KEYWORDS_HIGH = {
    "oh my god": 2.0,
    "holy shit": 2.0,
    "holy fuck": 2.0,
    "what the fuck": 2.0,
    "no fucking way": 2.0,
    "let's go": 2.0,
    "lets go": 2.0,
    "let's fucking go": 2.0,
    "no way": 2.0,
    "no way no way": 2.0,
    "i can't believe": 2.0,
    "are you kidding": 2.0,
    "are you serious": 2.0,
    "that was insane": 2.0,
    "that was crazy": 2.0,
}

KEYWORDS_MEDIUM = {
    "wow": 1.5,
    "dude": 1.5,
    "bro": 1.5,
    "finally": 1.5,
    "yes yes yes": 1.5,
    "clutch": 1.5,
    "huge": 1.5,
    "massive": 1.5,
    "gg": 1.5,
    "good game": 1.5,
    "rip": 1.5,
    "we died": 1.5,
    "i died": 1.5,
}

KEYWORDS_LOW = {
    "nice": 1.0,
    "sick": 1.0,
    "cool": 1.0,
    "okay okay": 1.0,
    "alright": 1.0,
    "here we go": 1.0,
}

ALL_KEYWORDS = {**KEYWORDS_HIGH, **KEYWORDS_MEDIUM, **KEYWORDS_LOW}


def extract_audio_to_wav(video_path: Path) -> Path:
    """Extract audio from video to a temporary WAV file (16kHz mono)."""
    temp_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    temp_path = Path(temp_file.name)
    temp_file.close()

    cmd = [
        "ffmpeg",
        "-i", str(video_path),
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        "-y",
        "-loglevel", "error",
        str(temp_path)
    ]

    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        temp_path.unlink(missing_ok=True)
        raise RuntimeError(f"FFmpeg audio extraction failed: {result.stderr.decode()}")

    return temp_path


def transcribe_audio(
    audio_path: Path,
    model_size: str,
    language: str,
    progress_callback: Callable[[str, int, str], None] | None = None
) -> list[TranscriptSegment]:
    """Transcribe audio using faster-whisper."""
    if progress_callback:
        progress_callback("loading_model", 5, "Loading Whisper model...")

    model = WhisperModel(model_size, device="auto", compute_type="auto")

    if progress_callback:
        progress_callback("transcribing", 10, "Transcribing audio...")

    segments_iter, info = model.transcribe(
        str(audio_path),
        language=language if language else None,
        beam_size=5,
        vad_filter=True,
    )

    segments = []
    total_duration = info.duration if info.duration else 0

    for segment in segments_iter:
        segments.append(TranscriptSegment(
            start=round(segment.start, 2),
            end=round(segment.end, 2),
            text=segment.text.strip()
        ))

        if progress_callback and total_duration > 0:
            percent = min(10 + int((segment.end / total_duration) * 70), 80)
            progress_callback("transcribing", percent, f"Transcribing... {int(segment.end)}s / {int(total_duration)}s")

    return segments


def merge_adjacent_segments(segments: list[TranscriptSegment], max_gap: float = 0.5) -> list[str]:
    """Merge adjacent segments into windows for keyword matching."""
    if not segments:
        return []

    windows = []
    current_texts = [segments[0].text]
    current_end = segments[0].end

    for segment in segments[1:]:
        if segment.start - current_end <= max_gap:
            current_texts.append(segment.text)
            current_end = segment.end
        else:
            windows.append(" ".join(current_texts))
            current_texts = [segment.text]
            current_end = segment.end

    if current_texts:
        windows.append(" ".join(current_texts))

    return windows


def detect_keywords(segments: list[TranscriptSegment]) -> list[SpeechMoment]:
    """Detect keyword matches in transcript segments."""
    moments = []
    merged_windows = merge_adjacent_segments(segments)

    segment_idx = 0
    for window_text in merged_windows:
        text_lower = window_text.lower()
        matched_keywords = []
        total_score = 0.0

        sorted_keywords = sorted(ALL_KEYWORDS.keys(), key=len, reverse=True)

        for keyword in sorted_keywords:
            if keyword in text_lower:
                matched_keywords.append(keyword)
                total_score += ALL_KEYWORDS[keyword]
                text_lower = text_lower.replace(keyword, "", 1)

        if matched_keywords:
            if len(matched_keywords) > 1:
                total_score *= 0.8

            while segment_idx < len(segments):
                seg_text_lower = segments[segment_idx].text.lower()
                if any(kw in seg_text_lower for kw in matched_keywords):
                    break
                segment_idx += 1

            if segment_idx < len(segments):
                segment = segments[segment_idx]
                moments.append(SpeechMoment(
                    timestamp=segment.start,
                    intensity=round(total_score, 2),
                    duration=round(segment.end - segment.start, 2),
                    moment_type="keyword_match",
                    details={
                        "text": window_text.strip(),
                        "matched_keywords": matched_keywords,
                        "keyword_score": round(total_score, 2),
                    }
                ))

    proximity_boost_window = 5.0
    for i, moment in enumerate(moments):
        nearby_count = sum(
            1 for other in moments
            if other != moment and abs(other.timestamp - moment.timestamp) <= proximity_boost_window
        )
        if nearby_count > 0:
            moment.intensity = round(moment.intensity * (1 + 0.2 * nearby_count), 2)
            moment.details["proximity_boost"] = nearby_count

    return moments


def calculate_segment_wpm(segment: TranscriptSegment) -> float:
    """Calculate words per minute for a segment."""
    words = len(segment.text.split())
    duration_minutes = (segment.end - segment.start) / 60.0
    if duration_minutes <= 0:
        return 0.0
    return words / duration_minutes


def detect_speech_rate_spikes(
    segments: list[TranscriptSegment],
    config: SpeechConfig
) -> list[SpeechMoment]:
    """Detect segments with unusually fast speech rate."""
    if not segments:
        return []

    total_speech_duration = sum(s.end - s.start for s in segments)
    if total_speech_duration < config.min_speech_for_baseline:
        return []

    valid_segments = [
        s for s in segments
        if len(s.text.split()) >= config.min_words_per_segment
    ]

    if not valid_segments:
        return []

    moments = []

    for i, segment in enumerate(valid_segments):
        baseline_start_time = max(0, segment.start - config.baseline_window)
        baseline_segments = [
            s for s in valid_segments
            if s.end <= segment.start and s.start >= baseline_start_time
        ]

        if not baseline_segments:
            continue

        baseline_total_words = sum(len(s.text.split()) for s in baseline_segments)
        baseline_total_duration = sum(s.end - s.start for s in baseline_segments)

        if baseline_total_duration < config.min_speech_for_baseline / 2:
            continue

        baseline_wpm = (baseline_total_words / baseline_total_duration) * 60

        if baseline_wpm < 50:
            continue

        current_wpm = calculate_segment_wpm(segment)
        ratio = current_wpm / baseline_wpm

        if ratio >= config.speech_rate_threshold:
            moments.append(SpeechMoment(
                timestamp=segment.start,
                intensity=round(ratio, 2),
                duration=round(segment.end - segment.start, 2),
                moment_type="speech_rate_spike",
                details={
                    "text": segment.text,
                    "words_per_minute": round(current_wpm, 1),
                    "baseline_wpm": round(baseline_wpm, 1),
                }
            ))

    return moments


def analyze_speech(
    video_path: Path,
    config: SpeechConfig | None = None,
    progress_callback: Callable[[str, int, str], None] | None = None
) -> tuple[list[SpeechMoment], list[TranscriptSegment]]:
    """Main entry point: analyze a video file for speech-based clip moments.

    Args:
        video_path: Path to the video file
        config: Analysis configuration (uses defaults if None)
        progress_callback: Optional callback for progress updates (stage, percent, message)

    Returns:
        Tuple of (list of detected moments, list of transcript segments)
    """
    if config is None:
        config = SpeechConfig()

    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    if progress_callback:
        progress_callback("extracting", 0, "Extracting audio from video...")

    audio_path = extract_audio_to_wav(video_path)

    try:
        segments = transcribe_audio(
            audio_path,
            config.model_size,
            config.language,
            progress_callback
        )

        if not segments:
            return [], []

        if progress_callback:
            progress_callback("analyzing", 85, "Detecting keywords...")

        keyword_moments = detect_keywords(segments)

        if progress_callback:
            progress_callback("analyzing", 95, "Analyzing speech rate...")

        rate_moments = detect_speech_rate_spikes(segments, config)

        all_moments = keyword_moments + rate_moments
        all_moments.sort(key=lambda m: m.timestamp)

        if progress_callback:
            progress_callback("complete", 100, "Analysis complete")

        return all_moments, segments

    finally:
        audio_path.unlink(missing_ok=True)
