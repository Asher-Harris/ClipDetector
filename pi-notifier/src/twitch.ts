import WebSocket from "ws";
import type { VODInfo } from "./discord";
import { loadTokens, saveTokens, clearTokens, type OAuthTokens } from "./store";

const TWITCH_API = "https://api.twitch.tv/helix";
const TWITCH_AUTH = "https://id.twitch.tv/oauth2";
const EVENTSUB_WS = "wss://eventsub.wss.twitch.tv/ws";

interface TwitchUser {
  id: string;
  login: string;
  displayName: string;
}

interface TwitchVideo {
  id: string;
  user_id: string;
  user_name: string;
  title: string;
  duration: string;
  thumbnail_url: string;
  url: string;
  created_at: string;
  type: string;
}

type EventHandler = {
  onStreamOffline: (userId: string, userLogin: string) => void;
  onConnected: () => void;
  onError: (error: Error) => void;
};

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export class AuthorizationError extends Error {
  constructor(
    message: string,
    public code: "ACCESS_DENIED" | "DEVICE_CODE_EXPIRED" | "REFRESH_FAILED"
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

let cachedTokens: OAuthTokens | null = null;

async function initiateDeviceAuth(clientId: string): Promise<DeviceCodeResponse> {
  const response = await fetch(`${TWITCH_AUTH}/device`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      scopes: "",
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to initiate device auth: ${response.statusText}`);
  }

  return response.json();
}

async function pollForAuthorization(
  clientId: string,
  deviceCode: string,
  interval: number,
  expiresIn: number
): Promise<OAuthTokens> {
  const startTime = Date.now();
  const expiresAt = startTime + expiresIn * 1000;

  while (Date.now() < expiresAt) {
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));

    const response = await fetch(`${TWITCH_AUTH}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data = await response.json();

    if (response.ok) {
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
        scope: data.scope || [],
      };
    }

    if (data.message === "authorization_pending") {
      continue;
    }

    if (data.message === "access_denied") {
      throw new AuthorizationError(
        "User denied the authorization request",
        "ACCESS_DENIED"
      );
    }

    if (data.message === "expired_token") {
      throw new AuthorizationError(
        "Device code expired - please restart authorization",
        "DEVICE_CODE_EXPIRED"
      );
    }
  }

  throw new AuthorizationError(
    "Authorization timed out",
    "DEVICE_CODE_EXPIRED"
  );
}

async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<OAuthTokens> {
  const response = await fetch(`${TWITCH_AUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new AuthorizationError(
      "Failed to refresh token - re-authorization required",
      "REFRESH_FAILED"
    );
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope || [],
  };
}

export async function getTwitchToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedTokens && Date.now() < cachedTokens.expiresAt - 60000) {
    return cachedTokens.accessToken;
  }

  const storedTokens = loadTokens();

  if (storedTokens) {
    if (Date.now() < storedTokens.expiresAt - 60000) {
      cachedTokens = storedTokens;
      return storedTokens.accessToken;
    }

    try {
      console.log("Token expired, refreshing...");
      const newTokens = await refreshAccessToken(clientId, clientSecret, storedTokens.refreshToken);
      saveTokens(newTokens);
      cachedTokens = newTokens;
      return newTokens.accessToken;
    } catch (error) {
      if (error instanceof AuthorizationError && error.code === "REFRESH_FAILED") {
        console.log("Refresh failed, clearing tokens and re-authenticating...");
        clearTokens();
      } else {
        throw error;
      }
    }
  }

  console.log("\n=== Twitch Authorization Required ===");
  const deviceAuth = await initiateDeviceAuth(clientId);
  console.log(`Please visit: ${deviceAuth.verification_uri}`);
  console.log(`Enter code: ${deviceAuth.user_code}`);
  console.log("\nWaiting for authorization...");

  const tokens = await pollForAuthorization(
    clientId,
    deviceAuth.device_code,
    deviceAuth.interval,
    deviceAuth.expires_in
  );

  console.log("Authorization successful!");
  saveTokens(tokens);
  cachedTokens = tokens;

  return tokens.accessToken;
}

export async function getUsersByLogin(
  clientId: string,
  accessToken: string,
  logins: string[]
): Promise<TwitchUser[]> {
  const params = logins.map((l) => `login=${encodeURIComponent(l)}`).join("&");
  const response = await fetch(`${TWITCH_API}/users?${params}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": clientId,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get users: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data.map((u: any) => ({
    id: u.id,
    login: u.login,
    displayName: u.display_name,
  }));
}

export async function getLatestVOD(
  clientId: string,
  accessToken: string,
  userId: string
): Promise<VODInfo | null> {
  const response = await fetch(
    `${TWITCH_API}/videos?user_id=${userId}&type=archive&first=1`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": clientId,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get VODs: ${response.statusText}`);
  }

  const data = await response.json();
  const videos: TwitchVideo[] = data.data;

  if (videos.length === 0) {
    return null;
  }

  const video = videos[0];
  return {
    id: video.id,
    title: video.title,
    streamerName: video.user_name,
    duration: video.duration,
    thumbnailUrl: video.thumbnail_url,
    url: video.url,
    createdAt: video.created_at,
  };
}

interface EventSubConnection {
  connect: () => void;
  close: () => void;
  subscribe: (userId: string) => Promise<void>;
}

export function createEventSubConnection(
  clientId: string,
  getAccessToken: () => Promise<string>,
  handlers: EventHandler
): EventSubConnection {
  let ws: WebSocket | null = null;
  let sessionId: string | null = null;
  let keepaliveTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let subscribedUserIds: Set<string> = new Set();
  let shouldReconnect = true;

  function resetKeepaliveTimeout(timeoutSeconds: number) {
    if (keepaliveTimeoutId) {
      clearTimeout(keepaliveTimeoutId);
    }
    keepaliveTimeoutId = setTimeout(() => {
      console.log("Keepalive timeout - reconnecting");
      reconnect();
    }, (timeoutSeconds + 10) * 1000);
  }

  async function subscribe(userId: string) {
    if (!sessionId) return;

    const accessToken = await getAccessToken();
    const response = await fetch(`${TWITCH_API}/eventsub/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Client-Id": clientId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "stream.offline",
        version: "1",
        condition: { broadcaster_user_id: userId },
        transport: { method: "websocket", session_id: sessionId },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to subscribe to stream.offline for ${userId}: ${error}`);
      return;
    }

    subscribedUserIds.add(userId);
    console.log(`Subscribed to stream.offline for user ${userId}`);
  }

  function connect() {
    ws = new WebSocket(EVENTSUB_WS);

    ws.onopen = () => {
      console.log("EventSub WebSocket connected");
    };

    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data.toString());
      const messageType = message.metadata?.message_type;

      if (messageType === "session_welcome") {
        sessionId = message.payload.session.id;
        const keepaliveTimeout = message.payload.session.keepalive_timeout_seconds;
        resetKeepaliveTimeout(keepaliveTimeout);
        handlers.onConnected();
      } else if (messageType === "session_keepalive") {
        resetKeepaliveTimeout(message.payload?.session?.keepalive_timeout_seconds || 10);
      } else if (messageType === "notification") {
        const subscriptionType = message.payload.subscription.type;
        if (subscriptionType === "stream.offline") {
          const userId = message.payload.event.broadcaster_user_id;
          const userLogin = message.payload.event.broadcaster_user_login;
          handlers.onStreamOffline(userId, userLogin);
        }
        resetKeepaliveTimeout(10);
      } else if (messageType === "session_reconnect") {
        const reconnectUrl = message.payload.session.reconnect_url;
        console.log(`Reconnecting to ${reconnectUrl}`);
        ws?.close();
        ws = new WebSocket(reconnectUrl);
      }
    };

    ws.onerror = (error) => {
      handlers.onError(new Error(`WebSocket error: ${error}`));
    };

    ws.onclose = () => {
      console.log("EventSub WebSocket closed");
      sessionId = null;
      subscribedUserIds.clear();
      if (keepaliveTimeoutId) {
        clearTimeout(keepaliveTimeoutId);
      }
      if (shouldReconnect) {
        reconnect();
      }
    };
  }

  function reconnect() {
    if (reconnectTimeoutId) return;
    reconnectTimeoutId = setTimeout(() => {
      reconnectTimeoutId = null;
      console.log("Attempting to reconnect...");
      connect();
    }, 5000);
  }

  function close() {
    shouldReconnect = false;
    if (keepaliveTimeoutId) {
      clearTimeout(keepaliveTimeoutId);
    }
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
    }
    ws?.close();
  }

  return { connect, close, subscribe };
}

export type { TwitchUser };
