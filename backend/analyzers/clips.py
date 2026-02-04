import math
from dataclasses import dataclass, field


@dataclass
class ClipsConfig:
    min_view_count: int = 10
    density_window_seconds: float = 60.0
    density_threshold: int = 3


@dataclass
class ClipsMoment:
    timestamp: float
    intensity: float
    duration: float
    moment_type: str
    details: dict = field(default_factory=dict)


def analyze_clips(
    clips: list[dict],
    vod_id: str,
    config: ClipsConfig | None = None,
) -> list[ClipsMoment]:
    if config is None:
        config = ClipsConfig()

    relevant = [
        c for c in clips
        if c.get("video_id") == vod_id
        and c.get("vod_offset") is not None
        and c.get("view_count", 0) >= config.min_view_count
    ]

    if not relevant:
        return []

    moments = []

    view_counts = [c["view_count"] for c in relevant]
    max_views = max(view_counts)
    log_max = math.log(max_views) if max_views > 1 else 1.0

    for clip in relevant:
        views = clip["view_count"]
        intensity = math.log(views) / log_max if views > 1 else 0.0
        moments.append(ClipsMoment(
            timestamp=float(clip["vod_offset"]) + float(clip.get("duration", 30)) / 2,
            intensity=round(intensity, 3),
            duration=float(clip.get("duration", 30)),
            moment_type="clip_popular",
            details={
                "title": clip.get("title", ""),
                "view_count": views,
                "creator": clip.get("creator_name", ""),
            },
        ))

    sorted_by_offset = sorted(relevant, key=lambda c: c["vod_offset"])

    for i, clip in enumerate(sorted_by_offset):
        window_start = clip["vod_offset"]
        window_end = window_start + config.density_window_seconds
        clips_in_window = [
            c for c in sorted_by_offset
            if window_start <= c["vod_offset"] < window_end
        ]
        count = len(clips_in_window)

        if count >= config.density_threshold:
            avg_duration = sum(c.get("duration", 30) for c in clips_in_window) / count
            center = sum(c["vod_offset"] for c in clips_in_window) / count + avg_duration / 2
            intensity = count / config.density_threshold
            moments.append(ClipsMoment(
                timestamp=round(center, 2),
                intensity=round(intensity, 3),
                duration=config.density_window_seconds,
                moment_type="clip_density",
                details={
                    "clip_count": count,
                    "window_seconds": config.density_window_seconds,
                },
            ))

    seen_timestamps = set()
    deduped = []
    for m in moments:
        if m.moment_type == "clip_density":
            key = (m.moment_type, round(m.timestamp / 10) * 10)
            if key in seen_timestamps:
                continue
            seen_timestamps.add(key)
        deduped.append(m)

    deduped.sort(key=lambda m: m.timestamp)
    return deduped
