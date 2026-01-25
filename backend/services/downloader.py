import asyncio
import re
import subprocess
from pathlib import Path
from typing import Callable


class TwitchDownloader:
    def __init__(self, cli_path: str = "TwitchDownloaderCLI"):
        self.cli_path = cli_path

    def _parse_progress(self, line: str) -> int | None:
        match = re.search(r"\[(\d+)%\]", line)
        if match:
            return int(match.group(1))

        match = re.search(r"(\d+(?:\.\d+)?)\s*%", line)
        if match:
            return int(float(match.group(1)))

        return None

    async def download_video(
        self,
        vod_id: str,
        output_path: Path,
        on_progress: Callable[[int], None] | None = None,
    ) -> bool:
        cmd = [
            self.cli_path,
            "videodownload",
            "--id", vod_id,
            "-o", str(output_path),
        ]

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        last_progress = -1
        while True:
            line = await process.stdout.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="ignore").strip()
            if on_progress and text:
                progress = self._parse_progress(text)
                if progress is not None and progress != last_progress:
                    on_progress(progress)
                    last_progress = progress

        await process.wait()
        return process.returncode == 0

    async def download_chat(
        self,
        vod_id: str,
        output_path: Path,
        on_progress: Callable[[int], None] | None = None,
    ) -> bool:
        cmd = [
            self.cli_path,
            "chatdownload",
            "--id", vod_id,
            "-o", str(output_path),
            "-E",
        ]

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        last_progress = -1
        while True:
            line = await process.stdout.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="ignore").strip()
            if on_progress and text:
                progress = self._parse_progress(text)
                if progress is not None and progress != last_progress:
                    on_progress(progress)
                    last_progress = progress

        await process.wait()
        return process.returncode == 0

    def is_available(self) -> bool:
        try:
            result = subprocess.run(
                [self.cli_path, "--version"],
                capture_output=True,
                timeout=5,
            )
            return result.returncode == 0
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False
