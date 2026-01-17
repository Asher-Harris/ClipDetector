from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .audio import AudioSpike, analyze_audio, AnalysisConfig as AudioConfig
from .chat import ChatMoment, analyze_chat, ChatConfig
from .speech import SpeechMoment, analyze_speech, SpeechConfig


@dataclass
class Signal:
    """A normalized signal from any analyzer."""
    timestamp: float
    intensity: float
    signal_type: str  # "audio" or "chat"
    weight: float     # base weight for this signal type


@dataclass
class ClipCandidate:
    """A potential clip with combined score from multiple signals."""
    timestamp: float      # center point of the detected moment
    score: float          # combined weighted score
    signals: list[str]    # which signals contributed
    clip_start: float     # timestamp - buffer
    clip_end: float       # timestamp + buffer


@dataclass
class FusionConfig:
    overlap_window: float = 10.0     # seconds: signals within this window are considered overlapping
    clip_buffer: float = 30.0        # seconds before and after the moment
    dedup_window: float = 30.0       # merge candidates within this many seconds
    audio_weight: float = 1.0
    chat_weight: float = 1.5         # chat activity is a strong signal
    audio_intensity_cap: float = 2.5 # max audio intensity to prevent runaway scores
    synergy_bonus: float = 0.75      # bonus multiplier per additional signal type
    min_score: float = 3.0           # minimum score to include a candidate
    speech_keyword_weight: float = 1.5   # keyword_match moments
    speech_rate_weight: float = 1.0      # speech_rate_spike moments


def normalize_signals(
    audio_spikes: list[AudioSpike],
    chat_moments: list[ChatMoment],
    config: FusionConfig,
    speech_moments: list[SpeechMoment] | None = None,
) -> list[Signal]:
    """Convert all analyzer outputs to normalized signals."""
    signals = []

    for spike in audio_spikes:
        signals.append(Signal(
            timestamp=spike.timestamp,
            intensity=min(spike.intensity, config.audio_intensity_cap),
            signal_type="audio",
            weight=config.audio_weight,
        ))

    for moment in chat_moments:
        signals.append(Signal(
            timestamp=moment.timestamp,
            intensity=moment.intensity,
            signal_type="chat",
            weight=config.chat_weight,
        ))

    if speech_moments:
        for moment in speech_moments:
            if moment.moment_type == "keyword_match":
                weight = config.speech_keyword_weight
                signal_type = "speech_keyword"
            else:
                weight = config.speech_rate_weight
                signal_type = "speech_rate"

            signals.append(Signal(
                timestamp=moment.timestamp,
                intensity=moment.intensity,
                signal_type=signal_type,
                weight=weight,
            ))

    # Sort by timestamp
    signals.sort(key=lambda s: s.timestamp)
    return signals


def cluster_signals(signals: list[Signal], window: float) -> list[list[Signal]]:
    """Group signals that occur within the overlap window of each other."""
    if not signals:
        return []

    clusters = []
    current_cluster = [signals[0]]

    for signal in signals[1:]:
        # Check if this signal is within the window of any signal in current cluster
        cluster_end = max(s.timestamp for s in current_cluster)
        if signal.timestamp - cluster_end <= window:
            current_cluster.append(signal)
        else:
            clusters.append(current_cluster)
            current_cluster = [signal]

    # Don't forget the last cluster
    if current_cluster:
        clusters.append(current_cluster)

    return clusters


def score_cluster(signals: list[Signal], config: FusionConfig) -> tuple[float, float, list[str]]:
    """Calculate the combined score for a cluster of signals.

    Returns:
        score: Combined weighted score
        timestamp: Center point of the cluster
        signal_types: List of signal types that contributed
    """
    if not signals:
        return 0.0, 0.0, []

    # Calculate weighted score: sum of (weight * intensity) for each signal
    total_score = sum(s.weight * s.intensity for s in signals)

    # Bonus for multiple different signal types (synergy)
    unique_types = set(s.signal_type for s in signals)
    if len(unique_types) > 1:
        synergy_multiplier = 1.0 + (len(unique_types) - 1) * config.synergy_bonus
        total_score *= synergy_multiplier

    # Timestamp: weighted average by intensity
    total_intensity = sum(s.intensity for s in signals)
    if total_intensity > 0:
        timestamp = sum(s.timestamp * s.intensity for s in signals) / total_intensity
    else:
        timestamp = signals[0].timestamp

    signal_types = [s.signal_type for s in signals]

    return round(total_score, 2), round(timestamp, 2), signal_types


def deduplicate_candidates(
    candidates: list[ClipCandidate],
    window: float
) -> list[ClipCandidate]:
    """Merge candidates that are within the dedup window, keeping the higher scored one."""
    if not candidates:
        return []

    # Sort by score descending
    sorted_candidates = sorted(candidates, key=lambda c: c.score, reverse=True)
    result = []

    for candidate in sorted_candidates:
        # Check if this candidate is too close to any already-kept candidate
        too_close = False
        for kept in result:
            if abs(candidate.timestamp - kept.timestamp) <= window:
                too_close = True
                break

        if not too_close:
            result.append(candidate)

    # Re-sort by timestamp for output
    result.sort(key=lambda c: c.timestamp)
    return result


def fuse_signals(
    audio_spikes: list[AudioSpike],
    chat_moments: list[ChatMoment],
    config: FusionConfig | None = None,
    speech_moments: list[SpeechMoment] | None = None,
) -> list[ClipCandidate]:
    """Main fusion function: combine signals and produce ranked clip candidates.

    Args:
        audio_spikes: Results from audio analyzer
        chat_moments: Results from chat analyzer
        config: Fusion configuration
        speech_moments: Optional results from speech analyzer

    Returns:
        List of clip candidates sorted by score descending
    """
    if config is None:
        config = FusionConfig()

    # Normalize all signals
    signals = normalize_signals(audio_spikes, chat_moments, config, speech_moments)

    if not signals:
        return []

    # Cluster signals by temporal proximity
    clusters = cluster_signals(signals, config.overlap_window)

    # Score each cluster and create candidates
    candidates = []
    for cluster in clusters:
        score, timestamp, signal_types = score_cluster(cluster, config)

        # Calculate clip boundaries
        clip_start = max(0, timestamp - config.clip_buffer)
        clip_end = timestamp + config.clip_buffer

        candidates.append(ClipCandidate(
            timestamp=timestamp,
            score=score,
            signals=signal_types,
            clip_start=round(clip_start, 2),
            clip_end=round(clip_end, 2),
        ))

    # Deduplicate nearby candidates
    candidates = deduplicate_candidates(candidates, config.dedup_window)

    # Filter by minimum score
    candidates = [c for c in candidates if c.score >= config.min_score]

    # Sort by score descending for final output
    candidates.sort(key=lambda c: c.score, reverse=True)

    return candidates


def analyze_full(
    video_path: Path,
    chat_path: Path,
    audio_config: AudioConfig | None = None,
    chat_config: ChatConfig | None = None,
    fusion_config: FusionConfig | None = None,
    include_speech: bool = False,
    speech_config: SpeechConfig | None = None,
    speech_progress_callback: Callable[[str, int, str], None] | None = None,
) -> list[ClipCandidate]:
    """Full analysis pipeline: audio + chat + optional speech + fusion.

    Args:
        video_path: Path to the video file
        chat_path: Path to the chat JSON file
        audio_config: Audio analysis configuration
        chat_config: Chat analysis configuration
        fusion_config: Fusion configuration
        include_speech: Whether to include speech analysis
        speech_config: Speech analysis configuration
        speech_progress_callback: Optional callback for speech analysis progress

    Returns:
        Ranked list of clip candidates
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    audio_spikes = []
    chat_moments = []
    speech_moments = []

    # Run audio + chat in parallel (both are light CPU operations)
    with ThreadPoolExecutor(max_workers=2) as executor:
        audio_future = executor.submit(analyze_audio, video_path, audio_config)
        chat_future = executor.submit(analyze_chat, chat_path, chat_config)

        for future in as_completed([audio_future, chat_future]):
            if future == audio_future:
                audio_spikes = future.result()
            else:
                chat_moments = future.result()

    # Run speech analysis sequentially (heavy GPU/CPU, avoid resource contention)
    if include_speech:
        speech_moments, _ = analyze_speech(
            video_path,
            speech_config,
            speech_progress_callback
        )

    candidates = fuse_signals(audio_spikes, chat_moments, fusion_config, speech_moments)

    return candidates
