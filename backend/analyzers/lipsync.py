import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path


@dataclass
class MouthCue:
    start: float
    end: float
    shape: str


@dataclass
class LipsyncConfig:
    fps: int = 30
    background_color: str = "00FF00"
    video_codec: str = "libx264"
    audio_codec: str = "aac"


class RhubarbNotFoundError(Exception):
    pass


class AvatarNotFoundError(Exception):
    def __init__(self, avatar_name: str, available_avatars: list[str]):
        self.avatar_name = avatar_name
        self.available_avatars = available_avatars
        super().__init__(
            f"Avatar '{avatar_name}' not found. Available: {', '.join(available_avatars) if available_avatars else 'none'}"
        )


class MissingMouthShapeError(Exception):
    def __init__(self, avatar_name: str, missing_shapes: list[str]):
        self.avatar_name = avatar_name
        self.missing_shapes = missing_shapes
        super().__init__(
            f"Avatar '{avatar_name}' is missing mouth shapes: {', '.join(missing_shapes)}"
        )


REQUIRED_SHAPES = ["A", "B", "C", "D", "E", "F", "G", "H"]


def get_rhubarb_path() -> Path:
    rhubarb_path = Path(__file__).parent.parent / "bin" / "Rhubarb-Lip-Sync-1.14.0-macOS" / "rhubarb"
    if not rhubarb_path.exists():
        raise RhubarbNotFoundError(
            f"Rhubarb not found. Expected at backend/bin/Rhubarb-Lip-Sync-1.14.0-macOS/rhubarb"
        )
    return rhubarb_path


def get_available_avatars(avatars_dir: Path) -> list[str]:
    if not avatars_dir.exists():
        return []
    return sorted([d.name for d in avatars_dir.iterdir() if d.is_dir()])


def validate_avatar(avatars_dir: Path, avatar_name: str) -> Path:
    available = get_available_avatars(avatars_dir)
    avatar_path = avatars_dir / avatar_name

    if not avatar_path.exists():
        raise AvatarNotFoundError(avatar_name, available)

    missing = [shape for shape in REQUIRED_SHAPES if not (avatar_path / f"{shape}.png").exists()]
    if missing:
        raise MissingMouthShapeError(avatar_name, missing)

    return avatar_path


def convert_mp3_to_wav(mp3_path: Path) -> Path:
    temp_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    temp_path = Path(temp_file.name)
    temp_file.close()

    cmd = [
        "ffmpeg", "-y",
        "-i", str(mp3_path),
        "-ar", "16000",
        "-ac", "1",
        "-acodec", "pcm_s16le",
        "-loglevel", "error",
        str(temp_path)
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        temp_path.unlink(missing_ok=True)
        raise RuntimeError(f"FFmpeg conversion failed: {result.stderr}")

    return temp_path


def run_rhubarb(audio_path: Path) -> list[MouthCue]:
    rhubarb_path = get_rhubarb_path()

    temp_output = tempfile.NamedTemporaryFile(suffix=".json", delete=False)
    temp_output_path = Path(temp_output.name)
    temp_output.close()

    wav_path = None
    if audio_path.suffix.lower() == ".mp3":
        wav_path = convert_mp3_to_wav(audio_path)
        input_path = wav_path
    else:
        input_path = audio_path

    try:
        cmd = [
            str(rhubarb_path),
            "-f", "json",
            "-o", str(temp_output_path),
            "--extendedShapes", "GH",
            "-q",
            str(input_path)
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

        if result.returncode != 0:
            raise RuntimeError(f"Rhubarb failed: {result.stderr}")

        with open(temp_output_path) as f:
            data = json.load(f)

        cues = []
        for cue in data.get("mouthCues", []):
            shape = cue["value"]
            if shape == "X":
                shape = "A"
            cues.append(MouthCue(
                start=round(cue["start"], 3),
                end=round(cue["end"], 3),
                shape=shape
            ))

        return cues

    finally:
        temp_output_path.unlink(missing_ok=True)
        if wav_path:
            wav_path.unlink(missing_ok=True)


def build_lipsync_filtergraph(cues: list[MouthCue], config: LipsyncConfig, duration: float) -> str:
    shape_to_input = {"A": 0, "B": 1, "C": 2, "D": 3, "E": 4, "F": 5, "G": 6, "H": 7}

    shape_intervals: dict[str, list[tuple[float, float]]] = {shape: [] for shape in shape_to_input}
    for cue in cues:
        shape_intervals[cue.shape].append((cue.start, cue.end))

    used_shapes = {shape for shape, intervals in shape_intervals.items() if intervals}

    filters = [f"color=c=#{config.background_color}:s=800x800:r={config.fps}:d={duration}[bg]"]

    for shape in REQUIRED_SHAPES:
        if shape in used_shapes:
            input_idx = shape_to_input[shape]
            filters.append(f"[{input_idx}:v]scale=800:800,format=rgba[shape{input_idx}]")

    current_base = "bg"
    overlay_idx = 0

    for shape in REQUIRED_SHAPES:
        intervals = shape_intervals.get(shape, [])
        if not intervals:
            continue

        input_idx = shape_to_input[shape]
        enable_parts = [f"between(t,{start},{end})" for start, end in intervals]
        enable_expr = "+".join(enable_parts)

        output_label = f"out{overlay_idx}"
        filters.append(
            f"[{current_base}][shape{input_idx}]overlay=0:0:enable='{enable_expr}'[{output_label}]"
        )
        current_base = output_label
        overlay_idx += 1

    filters.append(f"[{current_base}]copy[outv]")

    return ";".join(filters)


def generate_lipsync_video(
    audio_path: Path,
    avatar_path: Path,
    output_path: Path,
    config: LipsyncConfig | None = None
) -> Path:
    if config is None:
        config = LipsyncConfig()

    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    cues = run_rhubarb(audio_path)

    if not cues:
        raise RuntimeError("No mouth cues generated from audio")

    duration = cues[-1].end

    filter_complex = build_lipsync_filtergraph(cues, config, duration)

    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-t", str(duration), "-i", str(avatar_path / "A.png"),
        "-loop", "1", "-t", str(duration), "-i", str(avatar_path / "B.png"),
        "-loop", "1", "-t", str(duration), "-i", str(avatar_path / "C.png"),
        "-loop", "1", "-t", str(duration), "-i", str(avatar_path / "D.png"),
        "-loop", "1", "-t", str(duration), "-i", str(avatar_path / "E.png"),
        "-loop", "1", "-t", str(duration), "-i", str(avatar_path / "F.png"),
        "-loop", "1", "-t", str(duration), "-i", str(avatar_path / "G.png"),
        "-loop", "1", "-t", str(duration), "-i", str(avatar_path / "H.png"),
        "-i", str(audio_path),
        "-filter_complex", filter_complex,
        "-map", "[outv]",
        "-map", "8:a",
        "-t", str(duration),
        "-c:v", config.video_codec,
        "-preset", "fast",
        "-pix_fmt", "yuv420p",
        "-r", str(config.fps),
        "-c:a", config.audio_codec,
        "-b:a", "128k",
        str(output_path)
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg video generation failed: {result.stderr[:500]}")

    return output_path
