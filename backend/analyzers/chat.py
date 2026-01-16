import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ChatMoment:
    timestamp: float      # seconds into the VOD
    intensity: float      # how much it exceeded threshold (1.0 = at threshold)
    duration: float       # window duration in seconds
    moment_type: str      # "velocity_spike" or "emote_flood"
    details: dict = field(default_factory=dict)


@dataclass
class ChatConfig:
    window_seconds: float = 5.0          # sliding window size
    baseline_seconds: float = 30.0       # rolling average window for baseline
    velocity_threshold: float = 3.0      # spike if velocity > baseline * this
    emote_threshold: float = 0.5         # spike if emote_ratio > this in window
    min_messages_for_baseline: int = 10  # need this many messages for valid baseline


# Common Twitch hype emotes (checked by ID presence, not text matching)
HYPE_EMOTES = {
    "LUL", "KEKW", "PogChamp", "Pog", "OMEGALUL", "LULW", "PogU", "Pogey",
    "KEKLEO", "monkaS", "monkaW", "PepeHands", "Pepega", "POGGERS", "PagMan",
    "Clap", "EZ", "catJAM", "pepeD", "FeelsGoodMan", "FeelsBadMan", "HYPERS",
    "widepeepoHappy", "peepoClap", "COPIUM", "Sadge", "forsenCD", "xqcL",
}


def load_chat_log(file_path: Path) -> list[dict]:
    """Load and parse a Twitch chat JSON file."""
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Handle both formats: raw array or {"comments": [...]}
    if isinstance(data, list):
        return data
    return data.get("comments", [])


def extract_message_data(comments: list[dict]) -> list[dict]:
    """Extract timestamp and emote info from each message."""
    messages = []

    for comment in comments:
        # Get timestamp
        timestamp = comment.get("content_offset_seconds")
        if timestamp is None:
            continue

        # Count emotes in this message
        emote_count = 0
        message_obj = comment.get("message", {})
        fragments = message_obj.get("fragments", [])

        for fragment in fragments:
            if fragment.get("emoticon"):
                emote_count += 1

        # Also check for emote text in body as fallback
        body = message_obj.get("body", "")
        for emote in HYPE_EMOTES:
            if emote in body:
                emote_count += 1

        messages.append({
            "timestamp": float(timestamp),
            "emote_count": emote_count,
            "has_emote": emote_count > 0,
        })

    # Sort by timestamp
    messages.sort(key=lambda m: m["timestamp"])
    return messages


def get_messages_in_window(
    messages: list[dict],
    start_time: float,
    end_time: float
) -> list[dict]:
    """Get all messages within a time window."""
    return [m for m in messages if start_time <= m["timestamp"] < end_time]


def detect_velocity_spikes(
    messages: list[dict],
    config: ChatConfig
) -> list[ChatMoment]:
    """Detect sudden increases in chat velocity."""
    if not messages:
        return []

    moments = []
    start_time = messages[0]["timestamp"]
    end_time = messages[-1]["timestamp"]

    # Slide through the VOD in window-sized steps
    current_time = start_time + config.baseline_seconds

    while current_time < end_time:
        # Get baseline: messages in the period before current window
        baseline_start = current_time - config.baseline_seconds
        baseline_msgs = get_messages_in_window(messages, baseline_start, current_time)

        # Get current window
        window_end = current_time + config.window_seconds
        window_msgs = get_messages_in_window(messages, current_time, window_end)

        # Calculate velocities (messages per second)
        baseline_velocity = len(baseline_msgs) / config.baseline_seconds
        window_velocity = len(window_msgs) / config.window_seconds

        # Check for spike
        if (len(baseline_msgs) >= config.min_messages_for_baseline and
            baseline_velocity > 0 and
            window_velocity >= baseline_velocity * config.velocity_threshold):

            intensity = window_velocity / (baseline_velocity * config.velocity_threshold)

            moments.append(ChatMoment(
                timestamp=round(current_time, 2),
                intensity=round(intensity, 2),
                duration=config.window_seconds,
                moment_type="velocity_spike",
                details={
                    "messages_in_window": len(window_msgs),
                    "messages_per_second": round(window_velocity, 2),
                    "baseline_per_second": round(baseline_velocity, 2),
                }
            ))

        # Advance by half window for overlap
        current_time += config.window_seconds / 2

    return moments


def detect_emote_floods(
    messages: list[dict],
    config: ChatConfig
) -> list[ChatMoment]:
    """Detect windows with high emote concentration."""
    if not messages:
        return []

    moments = []
    start_time = messages[0]["timestamp"]
    end_time = messages[-1]["timestamp"]

    current_time = start_time

    while current_time < end_time:
        window_end = current_time + config.window_seconds
        window_msgs = get_messages_in_window(messages, current_time, window_end)

        if len(window_msgs) >= 5:  # Need enough messages to be meaningful
            emote_messages = sum(1 for m in window_msgs if m["has_emote"])
            emote_ratio = emote_messages / len(window_msgs)

            if emote_ratio >= config.emote_threshold:
                total_emotes = sum(m["emote_count"] for m in window_msgs)
                intensity = emote_ratio / config.emote_threshold

                moments.append(ChatMoment(
                    timestamp=round(current_time, 2),
                    intensity=round(intensity, 2),
                    duration=config.window_seconds,
                    moment_type="emote_flood",
                    details={
                        "messages_in_window": len(window_msgs),
                        "emote_messages": emote_messages,
                        "total_emotes": total_emotes,
                        "emote_ratio": round(emote_ratio, 2),
                    }
                ))

        # Advance by half window for overlap
        current_time += config.window_seconds / 2

    return moments


def analyze_chat(
    chat_path: Path,
    config: ChatConfig | None = None
) -> list[ChatMoment]:
    """Main entry point: analyze a chat log for hype moments.

    Args:
        chat_path: Path to the chat JSON file
        config: Analysis configuration (uses defaults if None)

    Returns:
        List of detected moments with timestamps and intensities
    """
    if config is None:
        config = ChatConfig()

    if not chat_path.exists():
        raise FileNotFoundError(f"Chat file not found: {chat_path}")

    # Load and parse chat
    comments = load_chat_log(chat_path)
    messages = extract_message_data(comments)

    if not messages:
        return []

    # Run detectors
    velocity_moments = detect_velocity_spikes(messages, config)
    emote_moments = detect_emote_floods(messages, config)

    # Combine and sort by timestamp
    all_moments = velocity_moments + emote_moments
    all_moments.sort(key=lambda m: m.timestamp)

    return all_moments
