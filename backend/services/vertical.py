import asyncio
import base64
import json
import logging
import os
import shutil
import tempfile
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger(__name__)

_layout_semaphore = asyncio.Semaphore(1)

CLIPS_DIR = Path(__file__).parent.parent.parent / "data" / "clips"

VALID_LAYOUT_TYPES = {"facecam_overlay", "gameplay_only", "facecam_dominant"}
VALID_CONFIDENCES = {"low", "medium", "high"}


@dataclass
class FrameClassification:
    layout_type: str
    facecam_center_x: float | None
    facecam_center_y: float | None
    facecam_width_pct: float | None
    facecam_height_pct: float | None
    confidence: str


@dataclass
class LayoutClassification:
    layout_type: str
    facecam_center_x: float | None
    facecam_center_y: float | None
    facecam_width_pct: float | None
    facecam_height_pct: float | None
    video_w: int
    video_h: int


CLASSIFICATION_PROMPT = (
    "You are analyzing 3 frames from a Twitch stream clip to classify the video layout.\n"
    "The frames are sampled from 10%, 50%, and 90% of the clip duration.\n"
    "\n"
    "For EACH frame, classify the layout independently. Return a JSON array with exactly 3 objects, one per frame in order.\n"
    "\n"
    "Layout types:\n"
    '- "facecam_overlay": Main content is gameplay with a smaller facecam/webcam overlay visible as a picture-in-picture window showing a person.\n'
    '- "gameplay_only": Only gameplay or screen content with no visible facecam/webcam.\n'
    '- "facecam_dominant": The facecam/person takes up most of the frame (60%+), with gameplay secondary or absent.\n'
    "\n"
    "For facecam_overlay only, also estimate the facecam's position and size as percentages of the full frame:\n"
    "- facecam_center_x: 0-100 (percentage from left edge)\n"
    "- facecam_center_y: 0-100 (percentage from top edge)\n"
    "- facecam_width_pct: 0-100 (approximate width as percentage of frame)\n"
    "- facecam_height_pct: 0-100 (approximate height as percentage of frame)\n"
    "\n"
    "Estimate the center position and size of the facecam as percentages of the full frame. You don't need to be pixel-perfect — a rough estimate within 5-10% is fine. Note: Twitch chat replay overlays (colored text on screen) are NOT facecams. The facecam is the window showing a person's face/body via webcam.\n"
    "Estimate tightly around the facecam window itself. Do not include chat overlays, stream info panels, or other UI elements in your estimate — only the webcam feed showing the person.\n"
    "\n"
    'Confidence: "high" (clear layout), "medium" (some ambiguity), "low" (uncertain).\n'
    "\n"
    'Return ONLY a JSON array. Each object: {"layout_type": str, "facecam_center_x": number|null, "facecam_center_y": number|null, "facecam_width_pct": number|null, "facecam_height_pct": number|null, "confidence": str}'
)


async def _get_video_info(clip_path: str) -> tuple[float, int, int]:
    """Returns (duration_seconds, width, height) via ffprobe."""
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_streams", "-show_format", clip_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    stdout, _ = await proc.communicate()
    info = json.loads(stdout)

    duration = float(info.get("format", {}).get("duration", 30))
    width, height = 1920, 1080
    for stream in info.get("streams", []):
        if stream.get("codec_type") == "video":
            width = stream.get("width", 1920)
            height = stream.get("height", 1080)
            break

    return duration, width, height


def _validate_frame(frame: dict) -> FrameClassification:
    layout_type = frame.get("layout_type", "")
    confidence = frame.get("confidence", "low")
    facecam_center_x = frame.get("facecam_center_x")
    facecam_center_y = frame.get("facecam_center_y")
    facecam_width_pct = frame.get("facecam_width_pct")
    facecam_height_pct = frame.get("facecam_height_pct")

    if layout_type not in VALID_LAYOUT_TYPES:
        confidence = "low"
    if confidence not in VALID_CONFIDENCES:
        confidence = "low"

    if layout_type == "facecam_overlay":
        pct_values = [facecam_center_x, facecam_center_y, facecam_width_pct, facecam_height_pct]
        if not all(isinstance(v, (int, float)) and 0 <= v <= 100 for v in pct_values):
            confidence = "low"
            facecam_center_x = facecam_center_y = facecam_width_pct = facecam_height_pct = None
    else:
        facecam_center_x = facecam_center_y = facecam_width_pct = facecam_height_pct = None

    return FrameClassification(
        layout_type=layout_type,
        facecam_center_x=facecam_center_x,
        facecam_center_y=facecam_center_y,
        facecam_width_pct=facecam_width_pct,
        facecam_height_pct=facecam_height_pct,
        confidence=confidence,
    )


async def _classify_frames(frame_images: list[str], api_key: str) -> list[FrameClassification]:
    import anthropic

    content = []
    for img_data in frame_images:
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": img_data,
            },
        })
    content.append({"type": "text", "text": CLASSIFICATION_PROMPT})

    client = anthropic.AsyncAnthropic(api_key=api_key)
    async with _layout_semaphore:
        message = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=512,
            messages=[{"role": "user", "content": content}],
        )

    text = message.content[0].text.strip()
    start = text.find("[")
    parsed, _ = json.JSONDecoder().raw_decode(text, start)

    return [_validate_frame(f) for f in parsed]


def _build_consensus(
    frames: list[FrameClassification], video_w: int, video_h: int
) -> tuple[LayoutClassification | None, str | None]:
    if all(f.confidence == "low" for f in frames):
        return None, "all frames low confidence"

    layout_types = [f.layout_type for f in frames]
    if len(set(layout_types)) > 1:
        return None, f"layout_type disagreement: {' vs '.join(layout_types)}"

    layout_type = layout_types[0]
    if layout_type not in VALID_LAYOUT_TYPES:
        return None, f"invalid layout_type: {layout_type}"

    facecam_center_x = None
    facecam_center_y = None
    facecam_width_pct = None
    facecam_height_pct = None

    if layout_type == "facecam_overlay":
        values = [
            (f.facecam_center_x, f.facecam_center_y, f.facecam_width_pct, f.facecam_height_pct)
            for f in frames
        ]

        if any(None in v for v in values):
            return None, "missing facecam position data"

        def _is_outlier(i):
            others = [j for j in range(3) if j != i]
            cx_diffs = [abs(values[i][0] - values[j][0]) for j in others]
            cy_diffs = [abs(values[i][1] - values[j][1]) for j in others]
            w_diffs = [abs(values[i][2] - values[j][2]) for j in others]
            h_diffs = [abs(values[i][3] - values[j][3]) for j in others]
            center_outlier = all(d > 20 for d in cx_diffs) or all(d > 20 for d in cy_diffs)
            size_outlier = all(d > 15 for d in w_diffs) or all(d > 15 for d in h_diffs)
            return center_outlier or size_outlier

        outliers = [i for i in range(3) if _is_outlier(i)]

        if len(outliers) >= 2:
            return None, "facecam position disagreement across frames"

        kept = [i for i in range(3) if i not in outliers]
        facecam_center_x = sum(values[i][0] for i in kept) / len(kept)
        facecam_center_y = sum(values[i][1] for i in kept) / len(kept)
        facecam_width_pct = sum(values[i][2] for i in kept) / len(kept)
        facecam_height_pct = sum(values[i][3] for i in kept) / len(kept)

    return LayoutClassification(
        layout_type=layout_type,
        facecam_center_x=facecam_center_x,
        facecam_center_y=facecam_center_y,
        facecam_width_pct=facecam_width_pct,
        facecam_height_pct=facecam_height_pct,
        video_w=video_w,
        video_h=video_h,
    ), None


async def _save_debug_artifacts(
    clip_id: str,
    frame_paths: list[str],
    frames: list[FrameClassification],
    consensus: LayoutClassification | None,
    skipped: bool,
    skip_reason: str | None,
    clip_path: str | None = None,
) -> None:
    debug_dir = CLIPS_DIR / "debug" / clip_id
    debug_dir.mkdir(parents=True, exist_ok=True)

    labels = ["frame_10.jpg", "frame_50.jpg", "frame_90.jpg"]
    for src, label in zip(frame_paths, labels):
        if Path(src).exists():
            shutil.copy2(src, debug_dir / label)

    classification = {
        "clip_id": clip_id,
        "frames": [asdict(f) for f in frames],
        "consensus": {
            "layout_type": consensus.layout_type,
            "facecam_center_x": consensus.facecam_center_x,
            "facecam_center_y": consensus.facecam_center_y,
            "facecam_width_pct": consensus.facecam_width_pct,
            "facecam_height_pct": consensus.facecam_height_pct,
        } if consensus else None,
        "skipped": skipped,
        "skip_reason": skip_reason,
    }
    (debug_dir / "classification.json").write_text(json.dumps(classification, indent=2))

    if consensus and consensus.facecam_center_x is not None and clip_path:
        cx, cy, cw, ch = _compute_facecam_crop(consensus)
        mid_frame = debug_dir / "frame_50.jpg"
        if mid_frame.exists():
            crop_out = debug_dir / "facecam_crop.jpg"
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg", "-y",
                "-i", str(mid_frame),
                "-vf", f"crop={cw}:{ch}:{cx}:{cy}",
                str(crop_out),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await proc.communicate()


def _log_classification(
    clip_id: str,
    frames: list[FrameClassification],
    consensus: LayoutClassification | None,
    skipped: bool,
    skip_reason: str | None,
) -> None:
    log_path = CLIPS_DIR / "classification_log.jsonl"
    log_path.parent.mkdir(parents=True, exist_ok=True)

    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "clip_id": clip_id,
        "layout_type": consensus.layout_type if consensus else None,
        "facecam_center_x": consensus.facecam_center_x if consensus else None,
        "facecam_center_y": consensus.facecam_center_y if consensus else None,
        "facecam_width_pct": consensus.facecam_width_pct if consensus else None,
        "facecam_height_pct": consensus.facecam_height_pct if consensus else None,
        "frame_confidences": [f.confidence for f in frames],
        "skipped": skipped,
        "skip_reason": skip_reason,
    }
    with open(log_path, "a") as f:
        f.write(json.dumps(entry) + "\n")


async def detect_layout(clip_path: str, api_key: str) -> LayoutClassification | None:
    clip_id = Path(clip_path).stem
    duration, video_w, video_h = await _get_video_info(clip_path)

    if duration < 2:
        timestamps = [duration / 2]
    else:
        timestamps = [duration * 0.1, duration * 0.5, duration * 0.9]
    timestamps = [min(t, duration - 0.5) if duration > 0.5 else 0 for t in timestamps]

    tmp_paths = []
    try:
        for ts in timestamps:
            tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
            tmp.close()
            tmp_paths.append(tmp.name)

            proc = await asyncio.create_subprocess_exec(
                "ffmpeg", "-y",
                "-ss", str(ts),
                "-i", clip_path,
                "-frames:v", "1",
                "-q:v", "2",
                tmp.name,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()
            if proc.returncode != 0 or not Path(tmp.name).exists() or Path(tmp.name).stat().st_size == 0:
                log.warning("Frame extraction failed at %.1fs for %s", ts, clip_id)
                return None

        log.info("Extracted %d frames for layout detection: %s", len(tmp_paths), clip_id)

        if not api_key:
            log.warning("No API key for layout detection, skipping: %s", clip_id)
            return None

        frame_images = []
        for p in tmp_paths:
            with open(p, "rb") as f:
                frame_images.append(base64.standard_b64encode(f.read()).decode("utf-8"))

        try:
            frames = await _classify_frames(frame_images, api_key)
        except Exception as exc:
            log.warning("AI classification failed for %s: %s", clip_id, exc)
            return None

        if len(frames) == 1:
            if frames[0].confidence != "high":
                log.info("Short clip %s: single frame not high confidence, skipping", clip_id)
                _log_classification(clip_id, frames, None, True, "short clip low confidence")
                await _save_debug_artifacts(clip_id, tmp_paths, frames, None, True, "short clip low confidence", clip_path)
                return None
            frames = frames * 3

        if len(frames) != 3:
            log.warning("Expected 3 classifications, got %d for %s", len(frames), clip_id)
            return None

        consensus, skip_reason = _build_consensus(frames, video_w, video_h)
        skipped = consensus is None

        await _save_debug_artifacts(clip_id, tmp_paths, frames, consensus, skipped, skip_reason, clip_path)
        _log_classification(clip_id, frames, consensus, skipped, skip_reason)

        if skipped:
            log.info("Skipping clip %s: %s", clip_id, skip_reason)
        else:
            log.info("Layout detected for %s: %s center=(%.0f%%,%.0f%%) size=(%.0f%%x%.0f%%)",
                     clip_id, consensus.layout_type,
                     consensus.facecam_center_x or 0, consensus.facecam_center_y or 0,
                     consensus.facecam_width_pct or 0, consensus.facecam_height_pct or 0)

        return consensus

    except Exception as exc:
        log.warning("Layout detection failed for %s: %s", clip_id, exc)
        return None
    finally:
        for p in tmp_paths:
            if Path(p).exists():
                os.unlink(p)


_EDGE_THRESHOLD_PCT = 4
_PAD_FRACTION = 0.08
_EXCLUSION_TOP_PCT = 5
_EXCLUSION_BOT_PCT = 5
_WEBCAM_RATIOS = (4 / 3, 16 / 9)
_RATIO_TOLERANCE = 0.15


def _compute_facecam_crop(layout: LayoutClassification) -> tuple[int, int, int, int]:
    cx_px = layout.facecam_center_x / 100 * layout.video_w
    cy_px = layout.facecam_center_y / 100 * layout.video_h
    raw_w = layout.facecam_width_pct / 100 * layout.video_w
    raw_h = layout.facecam_height_pct / 100 * layout.video_h

    left = cx_px - raw_w / 2
    right = cx_px + raw_w / 2
    top = cy_px - raw_h / 2
    bottom = cy_px + raw_h / 2

    pad_w = raw_w * _PAD_FRACTION
    pad_h = raw_h * _PAD_FRACTION

    if (left / layout.video_w * 100) <= _EDGE_THRESHOLD_PCT:
        left = 0
    else:
        left -= pad_w

    if ((layout.video_w - right) / layout.video_w * 100) <= _EDGE_THRESHOLD_PCT:
        right = layout.video_w
    else:
        right += pad_w

    if (top / layout.video_h * 100) <= _EDGE_THRESHOLD_PCT:
        top = 0
    else:
        top -= pad_h

    if ((layout.video_h - bottom) / layout.video_h * 100) <= _EDGE_THRESHOLD_PCT:
        bottom = layout.video_h
    else:
        bottom += pad_h

    excl_top = layout.video_h * _EXCLUSION_TOP_PCT / 100
    excl_bot = layout.video_h * (100 - _EXCLUSION_BOT_PCT) / 100
    top = max(top, excl_top)
    bottom = min(bottom, excl_bot)

    w = right - left
    h = bottom - top
    ratio = w / h if h > 0 else 1.0

    nearest = min(_WEBCAM_RATIOS, key=lambda r: abs(r - ratio))
    if abs(ratio - nearest) / nearest > _RATIO_TOLERANCE:
        new_w = h * nearest
        new_left = (left + right) / 2 - new_w / 2
        new_right = new_left + new_w
        if new_left >= 0 and new_right <= layout.video_w:
            left, right = new_left, new_right
        else:
            new_h = w / nearest
            center_y = (top + bottom) / 2
            top = center_y - new_h / 2
            bottom = center_y + new_h / 2

    left = max(0, left)
    top = max(0, top)
    right = min(right, layout.video_w)
    bottom = min(bottom, layout.video_h)

    x = round(left)
    y = round(top)
    w = round(right - left)
    h = round(bottom - top)
    return x, y, w, h


def _filtergraph_facecam_overlay(layout: LayoutClassification) -> str:
    cx, cy, cw, ch = _compute_facecam_crop(layout)
    fcam_h_out = 768
    game_h_out = 1920 - fcam_h_out

    center_w = round(layout.video_h * 1080 / game_h_out)
    center_w = min(center_w, layout.video_w)
    center_w -= center_w % 2

    return (
        f"[0:v]crop={cw}:{ch}:{cx}:{cy},"
        f"scale=1080:{fcam_h_out}:force_original_aspect_ratio=decrease,"
        f"pad=1080:{fcam_h_out}:(ow-iw)/2:(oh-ih)/2,setsar=1[top];"
        f"[0:v]crop={center_w}:{layout.video_h}:({layout.video_w}-{center_w})/2:0,"
        f"scale=1080:{game_h_out},setsar=1[bottom];"
        f"[top][bottom]vstack=inputs=2[out]"
    )


def _filtergraph_gameplay_only(layout: LayoutClassification) -> str:
    crop_w = round(layout.video_w * 0.7)
    crop_w -= crop_w % 2
    crop_x = (layout.video_w - crop_w) // 2

    return (
        f"[0:v]crop={crop_w}:{layout.video_h}:{crop_x}:0,"
        f"scale=1080:-2,"
        f"pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,"
        f"setsar=1[out]"
    )


def _filtergraph_facecam_dominant(layout: LayoutClassification) -> str:
    crop_w = round(layout.video_h * 9 / 16)
    crop_w -= crop_w % 2
    crop_x = (layout.video_w - crop_w) // 2

    return (
        f"[0:v]crop={crop_w}:{layout.video_h}:{crop_x}:0,"
        f"scale=1080:1920,setsar=1[out]"
    )


FILTERGRAPH_BUILDERS = {
    "facecam_overlay": _filtergraph_facecam_overlay,
    "gameplay_only": _filtergraph_gameplay_only,
    "facecam_dominant": _filtergraph_facecam_dominant,
}


async def convert_to_vertical(
    input_path: str, output_path: str, layout: LayoutClassification
) -> bool:
    builder = FILTERGRAPH_BUILDERS.get(layout.layout_type)
    if not builder:
        log.error("Unknown layout_type: %s", layout.layout_type)
        return False

    filtergraph = builder(layout)
    log.info("convert_to_vertical [%s]: %s\n  filtergraph: %s",
             layout.layout_type, Path(input_path).name, filtergraph)

    encode_args = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-filter_complex", filtergraph,
        "-map", "[out]",
        "-map", "0:a?",
        "-c:v", "libx264",
        "-crf", "23",
        "-preset", "fast",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        output_path,
    ]

    encode_proc = await asyncio.create_subprocess_exec(
        *encode_args,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr_output = await encode_proc.communicate()
    if encode_proc.returncode != 0:
        log.error("FFmpeg failed (rc=%d): %s", encode_proc.returncode, stderr_output.decode(errors="replace")[-2000:])
        Path(output_path).unlink(missing_ok=True)
        return False
    return Path(output_path).exists()
