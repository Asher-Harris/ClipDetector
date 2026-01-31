const DISCORD_API = "https://discord.com/api/v10";

interface VODInfo {
  id: string;
  title: string;
  streamerName: string;
  duration: string;
  thumbnailUrl: string;
  url: string;
  createdAt: string;
}

export async function sendDiscordDM(
  botToken: string,
  userId: string,
  vod: VODInfo
): Promise<boolean> {
  const dmChannel = await createDMChannel(botToken, userId);
  if (!dmChannel) {
    return false;
  }

  const embed = {
    title: `New VOD: ${vod.streamerName}`,
    description: vod.title,
    url: vod.url,
    color: 0x9146ff,
    fields: [
      { name: "Duration", value: vod.duration, inline: true },
      { name: "Created", value: formatDate(vod.createdAt), inline: true },
    ],
    thumbnail: {
      url: vod.thumbnailUrl.replace("%{width}", "320").replace("%{height}", "180"),
    },
    footer: {
      text: "ClipDetector Notifier",
    },
  };

  const response = await fetch(`${DISCORD_API}/channels/${dmChannel}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      embeds: [embed],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Failed to send Discord DM: ${error}`);
    return false;
  }

  return true;
}

async function createDMChannel(botToken: string, userId: string): Promise<string | null> {
  const response = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient_id: userId,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Failed to create DM channel: ${error}`);
    return null;
  }

  const data = await response.json();
  return data.id;
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function sendTestMessage(
  botToken: string,
  userId: string,
  message: string
): Promise<boolean> {
  const dmChannel = await createDMChannel(botToken, userId);
  if (!dmChannel) {
    return false;
  }

  const response = await fetch(`${DISCORD_API}/channels/${dmChannel}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: message }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`Failed to send Discord DM: ${error}`);
    return false;
  }

  return true;
}

export type { VODInfo };
