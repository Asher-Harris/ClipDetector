import tempfile
import unittest
from pathlib import Path

from analyzers.audio import AudioSpike
from analyzers.fusion import FusionConfig, fuse_signals
from main import ProfileCreateRequest, parse_byte_range, resolve_safe_path


class PathSafetyTests(unittest.TestCase):
    def test_resolves_files_inside_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            self.assertEqual(
                resolve_safe_path("vods/example.mp4", root),
                (root / "vods" / "example.mp4").resolve(),
            )

    def test_rejects_sibling_with_shared_prefix(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "data"
            root.mkdir()

            with self.assertRaises(ValueError):
                resolve_safe_path("../data-backup/secret.json", root)


class ByteRangeTests(unittest.TestCase):
    def test_parses_bounded_and_open_ranges(self) -> None:
        self.assertEqual(parse_byte_range("bytes=10-19", 100), (10, 19))
        self.assertEqual(parse_byte_range("bytes=90-", 100), (90, 99))

    def test_parses_suffix_range(self) -> None:
        self.assertEqual(parse_byte_range("bytes=-25", 100), (75, 99))

    def test_rejects_malformed_or_unsatisfiable_ranges(self) -> None:
        for header in ("items=0-1", "bytes=", "bytes=100-101", "bytes=5-4"):
            with self.subTest(header=header), self.assertRaises(ValueError):
                parse_byte_range(header, 100)


class ConfigurationTests(unittest.TestCase):
    def test_profile_accepts_all_frontend_weights(self) -> None:
        profile = ProfileCreateRequest(
            name="Custom",
            speech_keyword_weight=2.25,
            speech_rate_weight=1.75,
            clip_popular_weight=4.0,
            clip_density_weight=3.0,
        )

        self.assertEqual(profile.speech_keyword_weight, 2.25)
        self.assertEqual(profile.speech_rate_weight, 1.75)
        self.assertEqual(profile.clip_popular_weight, 4.0)
        self.assertEqual(profile.clip_density_weight, 3.0)

    def test_zero_weight_remains_a_valid_fusion_setting(self) -> None:
        candidates = fuse_signals(
            [AudioSpike(timestamp=10, intensity=3, duration=0.1)],
            [],
            FusionConfig(audio_weight=0, min_score=0),
        )

        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].score, 0)


if __name__ == "__main__":
    unittest.main()
