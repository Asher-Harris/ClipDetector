import json
import re
import time
from dataclasses import dataclass
from pathlib import Path

import httpx


def parse_duration_to_seconds(duration: str) -> int | None:
    """Parse Twitch duration format (e.g., '4h44m4s') to seconds."""
    if not duration:
        return None
    match = re.match(r"(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?", duration)
    if not match:
        return None
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    return hours * 3600 + minutes * 60 + seconds


@dataclass
class TwitchChannel:
    id: str
    login: str
    display_name: str
    profile_image_url: str | None = None


@dataclass
class TwitchVod:
    id: str
    channel_login: str
    title: str
    created_at: str
    duration: str
    thumbnail_url: str
    view_count: int
    downloaded: bool = False
    video_filename: str | None = None
    chat_filename: str | None = None
    channel_display_name: str | None = None
    channel_profile_image_url: str | None = None
    duration_seconds: int | None = None


class TwitchClient:
    TOKEN_URL = "https://id.twitch.tv/oauth2/token"
    HELIX_URL = "https://api.twitch.tv/helix"

    def __init__(self, client_id: str, client_secret: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self._token: str | None = None
        self._token_expires_at: float = 0

    async def _get_token(self) -> str:
        if self._token and time.time() < self._token_expires_at - 60:
            return self._token

        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.TOKEN_URL,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "grant_type": "client_credentials",
                },
            )
            response.raise_for_status()
            data = response.json()

        self._token = data["access_token"]
        self._token_expires_at = time.time() + data["expires_in"]
        return self._token

    async def _request(self, endpoint: str, params: dict | None = None) -> dict:
        token = await self._get_token()
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.HELIX_URL}{endpoint}",
                params=params,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Client-Id": self.client_id,
                },
            )
            response.raise_for_status()
            return response.json()

    async def get_user(self, login: str) -> TwitchChannel | None:
        data = await self._request("/users", {"login": login})
        users = data.get("data", [])
        if not users:
            return None
        user = users[0]
        return TwitchChannel(
            id=user["id"],
            login=user["login"],
            display_name=user["display_name"],
            profile_image_url=user.get("profile_image_url"),
        )

    async def get_channel_vods(
        self, user_id: str, limit: int = 20
    ) -> list[dict]:
        data = await self._request(
            "/videos",
            {"user_id": user_id, "type": "archive", "first": limit},
        )
        return data.get("data", [])


class VodStorage:
    def __init__(self, storage_path: Path):
        self.storage_path = storage_path
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> dict:
        if not self.storage_path.exists():
            return {"channels": {}, "vods": []}
        with open(self.storage_path) as f:
            return json.load(f)

    def save(self, data: dict) -> None:
        with open(self.storage_path, "w") as f:
            json.dump(data, f, indent=2)

    def get_vod(self, vod_id: str) -> dict | None:
        data = self.load()
        for vod in data.get("vods", []):
            if vod["id"] == vod_id:
                return vod
        return None

    def update_vod(self, vod_id: str, updates: dict) -> None:
        data = self.load()
        for vod in data.get("vods", []):
            if vod["id"] == vod_id:
                vod.update(updates)
                break
        self.save(data)

    def merge_vods(
        self, channel_login: str, channel_info: dict, new_vods: list[dict]
    ) -> None:
        data = self.load()

        data["channels"][channel_login] = channel_info

        existing_ids = {v["id"] for v in data.get("vods", [])}

        for vod in new_vods:
            if vod["id"] not in existing_ids:
                data["vods"].append({
                    "id": vod["id"],
                    "channel_login": channel_login,
                    "title": vod["title"],
                    "created_at": vod["created_at"],
                    "duration": vod["duration"],
                    "thumbnail_url": vod["thumbnail_url"]
                        .replace("%{width}", "320")
                        .replace("%{height}", "180"),
                    "view_count": vod["view_count"],
                    "downloaded": False,
                    "video_filename": None,
                    "chat_filename": None,
                })

        data["vods"].sort(key=lambda v: v["created_at"], reverse=True)
        self.save(data)

    def get_vod_with_paths(self, vod_id: str) -> dict | None:
        """Returns VOD with video_path and chat_path computed."""
        data = self.load()
        channels = data.get("channels", {})

        for vod in data.get("vods", []):
            if vod["id"] == vod_id:
                channel_info = channels.get(vod.get("channel_login"), {})
                result = {**vod}
                result["channel_display_name"] = channel_info.get("display_name")
                result["channel_profile_image_url"] = channel_info.get("profile_image_url")
                result["duration_seconds"] = parse_duration_to_seconds(vod.get("duration", ""))

                if vod.get("video_filename"):
                    result["video_path"] = f"vods/{vod['video_filename']}"
                else:
                    result["video_path"] = None

                if vod.get("chat_filename"):
                    result["chat_path"] = f"chats/{vod['chat_filename']}"
                else:
                    result["chat_path"] = None

                return result
        return None

    def list_downloaded_vods_with_channel_info(self) -> list[dict]:
        """Returns downloaded VODs with embedded channel info and computed paths."""
        data = self.load()
        channels = data.get("channels", {})
        result = []

        for vod in data.get("vods", []):
            if not vod.get("downloaded"):
                continue

            channel_info = channels.get(vod.get("channel_login"), {})
            vod_with_info = {**vod}
            vod_with_info["channel_display_name"] = channel_info.get("display_name")
            vod_with_info["channel_profile_image_url"] = channel_info.get("profile_image_url")
            vod_with_info["duration_seconds"] = parse_duration_to_seconds(vod.get("duration", ""))

            if vod.get("video_filename"):
                vod_with_info["video_path"] = f"vods/{vod['video_filename']}"
            else:
                vod_with_info["video_path"] = None

            if vod.get("chat_filename"):
                vod_with_info["chat_path"] = f"chats/{vod['chat_filename']}"
            else:
                vod_with_info["chat_path"] = None

            result.append(vod_with_info)

        return result
