import asyncio
import re
from pathlib import Path
from typing import Callable


class TwitchDownloader:
    def __init__(self, cli_path: str = "TwitchDownloaderCLI"):
        self.cli_path = cli_path
        self.active_processes: list[asyncio.subprocess.Process] = []

    def _parse_progress(self, text: str) -> int | None:
        match = re.search(r"(\d+(?:\.\d+)?)\s*%", text)
        if match:
            return int(float(match.group(1)))
        return None

    async def _read_output_with_cr(
        self,
        process: asyncio.subprocess.Process,
        on_progress: Callable[[int], None] | None,
    ) -> None:
        last_progress = -1
        buffer = b""

        while True:
            chunk = await process.stdout.read(256)
            if not chunk:
                break

            buffer += chunk

            while b"\r" in buffer or b"\n" in buffer:
                cr_pos = buffer.find(b"\r")
                nl_pos = buffer.find(b"\n")

                if cr_pos == -1:
                    split_pos = nl_pos
                elif nl_pos == -1:
                    split_pos = cr_pos
                else:
                    split_pos = min(cr_pos, nl_pos)

                line = buffer[:split_pos].decode("utf-8", errors="ignore").strip()
                buffer = buffer[split_pos + 1:]

                if on_progress and line:
                    progress = self._parse_progress(line)
                    if progress is not None and progress != last_progress:
                        on_progress(progress)
                        last_progress = progress

        if buffer:
            line = buffer.decode("utf-8", errors="ignore").strip()
            if on_progress and line:
                progress = self._parse_progress(line)
                if progress is not None and progress != last_progress:
                    on_progress(progress)

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
        self.active_processes.append(process)

        try:
            await self._read_output_with_cr(process, on_progress)
            await process.wait()
            return process.returncode == 0
        finally:
            if process in self.active_processes:
                self.active_processes.remove(process)

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
        self.active_processes.append(process)

        try:
            await self._read_output_with_cr(process, on_progress)
            await process.wait()
            return process.returncode == 0
        finally:
            if process in self.active_processes:
                self.active_processes.remove(process)

    async def download_clip(
        self,
        clip_id: str,
        output_path: Path,
        on_progress: Callable[[int], None] | None = None,
    ) -> bool:
        cmd = [
            self.cli_path,
            "clipdownload",
            "--id", clip_id,
            "-o", str(output_path),
        ]

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        self.active_processes.append(process)

        try:
            await self._read_output_with_cr(process, on_progress)
            await process.wait()
            return process.returncode == 0
        finally:
            if process in self.active_processes:
                self.active_processes.remove(process)

    def cancel(self) -> bool:
        cancelled = False
        for process in self.active_processes:
            if process.returncode is None:
                process.terminate()
                cancelled = True
        return cancelled

    def is_available(self) -> bool:
        import subprocess
        try:
            result = subprocess.run(
                [self.cli_path, "--version"],
                capture_output=True,
                timeout=5,
            )
            return b"TwitchDownloaderCLI" in result.stderr or b"TwitchDownloaderCLI" in result.stdout
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False
