import bisect
import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class ChatMoment:
    timestamp: float      # seconds into the VOD
    intensity: float      # how much it exceeded threshold (1.0 = at threshold)
    duration: float       # window duration in seconds
    moment_type: str      # "chat"
    details: dict = field(default_factory=dict)


@dataclass
class ChatConfig:
    window_seconds: float = 5.0          # sliding window size
    baseline_seconds: float = 30.0       # rolling average window for baseline
    threshold: float = 3.0               # spike if velocity > baseline * this
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
    timestamps: list[float],
    start_time: float,
    end_time: float
) -> list[dict]:
    """Get all messages within a time window using binary search."""
    start_idx = bisect.bisect_left(timestamps, start_time)
    end_idx = bisect.bisect_left(timestamps, end_time)
    return messages[start_idx:end_idx]


def detect_chat_spikes(
    messages: list[dict],
    config: ChatConfig
) -> list[ChatMoment]:
    """Detect sudden increases in chat activity."""
    if not messages:
        return []

    timestamps = [m["timestamp"] for m in messages]

    moments = []
    start_time = timestamps[0]
    end_time = timestamps[-1]

    current_time = start_time + config.baseline_seconds

    while current_time < end_time:
        baseline_start = current_time - config.baseline_seconds
        baseline_msgs = get_messages_in_window(messages, timestamps, baseline_start, current_time)

        window_end = current_time + config.window_seconds
        window_msgs = get_messages_in_window(messages, timestamps, current_time, window_end)

        baseline_velocity = len(baseline_msgs) / config.baseline_seconds
        window_velocity = len(window_msgs) / config.window_seconds

        if (len(baseline_msgs) >= config.min_messages_for_baseline and
            baseline_velocity > 0 and
            window_velocity >= baseline_velocity * config.threshold):

            intensity = window_velocity / (baseline_velocity * config.threshold)

            moments.append(ChatMoment(
                timestamp=round(current_time, 2),
                intensity=round(intensity, 2),
                duration=config.window_seconds,
                moment_type="chat",
                details={
                    "messages_in_window": len(window_msgs),
                    "messages_per_second": round(window_velocity, 2),
                    "baseline_per_second": round(baseline_velocity, 2),
                }
            ))

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

    # Detect chat activity spikes
    moments = detect_chat_spikes(messages, config)
    moments.sort(key=lambda m: m.timestamp)

    return moments
