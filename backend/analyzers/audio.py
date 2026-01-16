import subprocess
import tempfile
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import librosa


@dataclass
class AudioSpike:
    timestamp: float  # seconds into the video
    intensity: float  # how much it exceeded the threshold (1.0 = exactly at threshold)
    duration: float   # approximate duration of the spike in seconds


@dataclass
class AnalysisConfig:
    threshold_multiplier: float = 2.5  # spike if loudness > avg * this value
    window_seconds: float = 10.0       # rolling window for computing average
    chunk_ms: int = 100                # analysis resolution in milliseconds
    min_spike_gap: float = 1.0         # merge spikes closer than this (seconds)
    sample_rate: int = 22050           # downsample for efficiency


def extract_audio(video_path: Path, output_path: Path, sample_rate: int = 22050) -> None:
    """Extract audio from video file to WAV using FFmpeg."""
    cmd = [
        "ffmpeg",
        "-i", str(video_path),
        "-vn",                    # no video
        "-acodec", "pcm_s16le",   # PCM 16-bit
        "-ar", str(sample_rate),  # sample rate
        "-ac", "1",               # mono
        "-y",                     # overwrite
        str(output_path)
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg failed: {result.stderr}")


def compute_rms_envelope(
    audio: np.ndarray,
    sample_rate: int,
    chunk_ms: int
) -> tuple[np.ndarray, float]:
    """Compute RMS energy for each chunk of audio.

    Returns:
        rms: array of RMS values, one per chunk
        chunk_duration: duration of each chunk in seconds
    """
    # Calculate samples per chunk
    samples_per_chunk = int(sample_rate * chunk_ms / 1000)

    # Use librosa's RMS with our chunk size
    rms = librosa.feature.rms(
        y=audio,
        frame_length=samples_per_chunk,
        hop_length=samples_per_chunk,
        center=False
    )[0]

    chunk_duration = chunk_ms / 1000.0
    return rms, chunk_duration


def detect_spikes(
    rms: np.ndarray,
    chunk_duration: float,
    config: AnalysisConfig
) -> list[AudioSpike]:
    """Detect loudness spikes by comparing to rolling average."""

    # Number of chunks in the rolling window
    window_chunks = int(config.window_seconds / chunk_duration)

    spikes = []

    for i in range(len(rms)):
        # Get the window of chunks before this one (not including current)
        window_start = max(0, i - window_chunks)
        window = rms[window_start:i]

        if len(window) < window_chunks // 2:
            # Not enough history yet, skip
            continue

        avg = np.mean(window)
        if avg < 1e-6:
            # Silence, skip
            continue

        current = rms[i]
        ratio = current / avg

        if ratio >= config.threshold_multiplier:
            timestamp = i * chunk_duration
            # Intensity: how much above threshold (1.0 = exactly at threshold)
            intensity = ratio / config.threshold_multiplier
            spikes.append(AudioSpike(
                timestamp=round(timestamp, 2),
                intensity=round(intensity, 2),
                duration=chunk_duration
            ))

    return spikes


def merge_nearby_spikes(
    spikes: list[AudioSpike],
    min_gap: float
) -> list[AudioSpike]:
    """Merge spikes that are close together, keeping the highest intensity."""
    if not spikes:
        return []

    merged = []
    current_group = [spikes[0]]

    for spike in spikes[1:]:
        # Check if this spike is close to the last one in the group
        if spike.timestamp - current_group[-1].timestamp <= min_gap:
            current_group.append(spike)
        else:
            # Finish current group: take the spike with highest intensity
            best = max(current_group, key=lambda s: s.intensity)
            # Update duration to span the group
            best.duration = round(
                current_group[-1].timestamp - current_group[0].timestamp + current_group[-1].duration,
                2
            )
            best.timestamp = current_group[0].timestamp
            merged.append(best)
            current_group = [spike]

    # Don't forget the last group
    if current_group:
        best = max(current_group, key=lambda s: s.intensity)
        best.duration = round(
            current_group[-1].timestamp - current_group[0].timestamp + current_group[-1].duration,
            2
        )
        best.timestamp = current_group[0].timestamp
        merged.append(best)

    return merged


def analyze_audio(
    video_path: Path,
    config: AnalysisConfig | None = None
) -> list[AudioSpike]:
    """Main entry point: analyze a video file for audio loudness spikes.

    Args:
        video_path: Path to the video file
        config: Analysis configuration (uses defaults if None)

    Returns:
        List of detected spikes with timestamps and intensities
    """
    if config is None:
        config = AnalysisConfig()

    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    # Extract audio to temp file
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = Path(tmp.name)

    try:
        extract_audio(video_path, tmp_path, config.sample_rate)

        # Load audio
        audio, sr = librosa.load(tmp_path, sr=config.sample_rate, mono=True)

        # Compute RMS envelope
        rms, chunk_duration = compute_rms_envelope(audio, sr, config.chunk_ms)

        # Detect spikes
        spikes = detect_spikes(rms, chunk_duration, config)

        # Merge nearby spikes
        spikes = merge_nearby_spikes(spikes, config.min_spike_gap)

        return spikes

    finally:
        # Clean up temp file
        if tmp_path.exists():
            os.unlink(tmp_path)
