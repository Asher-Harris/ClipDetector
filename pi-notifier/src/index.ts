import { sendDiscordDM, sendTestMessage, type VODInfo } from "./discord";
import { isVodKnown, markVodAsKnown } from "./store";
import {
  AuthorizationError,
  createEventSubConnection,
  getLatestVOD,
  getTwitchToken,
  getUsersByLogin,
  type TwitchUser,
} from "./twitch";

const TEST_MODE = process.argv.includes("--test");

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID!;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET!;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;
const DISCORD_USER_ID = process.env.DISCORD_USER_ID!;
const TWITCH_CHANNELS = process.env.TWITCH_CHANNELS?.split(",").map((c) => c.trim()) || [];

const VOD_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const VOD_CHECK_MAX_DURATION_MS = 72 * 60 * 60 * 1000;

interface PendingVODCheck {
  userId: string;
  userLogin: string;
  startedAt: number;
  intervalId: ReturnType<typeof setInterval>;
}

const pendingChecks = new Map<string, PendingVODCheck>();

function validateEnv() {
  const required = [
    "TWITCH_CLIENT_ID",
    "TWITCH_CLIENT_SECRET",
    "DISCORD_BOT_TOKEN",
    "DISCORD_USER_ID",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (TWITCH_CHANNELS.length === 0) {
    console.error("TWITCH_CHANNELS is empty - no channels to watch");
    process.exit(1);
  }
}

async function checkForNewVOD(userId: string, userLogin: string): Promise<VODInfo | null> {
  const token = await getTwitchToken(TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET);
  const vod = await getLatestVOD(TWITCH_CLIENT_ID, token, userId);

  if (!vod) {
    return null;
  }

  if (isVodKnown(vod.id)) {
    return null;
  }

  return vod;
}

async function notifyNewVOD(vod: VODInfo) {
  console.log(`New VOD detected: ${vod.streamerName} - ${vod.title}`);
  markVodAsKnown(vod.id);

  const success = await sendDiscordDM(DISCORD_BOT_TOKEN, DISCORD_USER_ID, vod);
  if (success) {
    console.log(`Discord DM sent for VOD ${vod.id}`);
  } else {
    console.error(`Failed to send Discord DM for VOD ${vod.id}`);
  }
}

function startVODPolling(userId: string, userLogin: string) {
  if (pendingChecks.has(userId)) {
    console.log(`Already polling for VOD from ${userLogin}`);
    return;
  }

  console.log(`Starting VOD polling for ${userLogin}`);

  const check = async () => {
    try {
      const vod = await checkForNewVOD(userId, userLogin);
      if (vod) {
        await notifyNewVOD(vod);
        stopVODPolling(userId);
      }
    } catch (error) {
      console.error(`Error checking VOD for ${userLogin}:`, error);
    }
  };

  check();

  const intervalId = setInterval(async () => {
    const pending = pendingChecks.get(userId);
    if (!pending) return;

    if (Date.now() - pending.startedAt > VOD_CHECK_MAX_DURATION_MS) {
      console.log(`VOD polling timeout for ${userLogin} - no VOD found after 72 hours`);
      stopVODPolling(userId);
      return;
    }

    await check();
  }, VOD_CHECK_INTERVAL_MS);

  pendingChecks.set(userId, {
    userId,
    userLogin,
    startedAt: Date.now(),
    intervalId,
  });
}

function stopVODPolling(userId: string) {
  const pending = pendingChecks.get(userId);
  if (pending) {
    clearInterval(pending.intervalId);
    pendingChecks.delete(userId);
    console.log(`Stopped VOD polling for ${pending.userLogin}`);
  }
}

async function runTest() {
  console.log("Running Discord DM test...");
  const success = await sendTestMessage(DISCORD_BOT_TOKEN, DISCORD_USER_ID, "Hi from ClipDetector Notifier!");
  if (success) {
    console.log("Test message sent successfully!");
  } else {
    console.error("Failed to send test message");
  }
  process.exit(success ? 0 : 1);
}

async function main() {
  validateEnv();

  if (TEST_MODE) {
    return runTest();
  }

  console.log(`ClipDetector Notifier starting...`);
  console.log(`Watching channels: ${TWITCH_CHANNELS.join(", ")}`);
  console.log("Authenticating with Twitch...");

  let token: string;
  try {
    token = await getTwitchToken(TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      if (error.code === "ACCESS_DENIED") {
        console.error("Authorization denied by user. Please try again and approve the request.");
        process.exit(1);
      }
      if (error.code === "DEVICE_CODE_EXPIRED") {
        console.error("Authorization timed out. Please restart and complete authorization within 30 minutes.");
        process.exit(1);
      }
    }
    throw error;
  }

  const users = await getUsersByLogin(TWITCH_CLIENT_ID, token, TWITCH_CHANNELS);

  if (users.length === 0) {
    console.error("No valid Twitch users found for the configured channels");
    process.exit(1);
  }

  console.log(`Resolved ${users.length} channels: ${users.map((u) => u.displayName).join(", ")}`);

  const userMap = new Map<string, TwitchUser>();
  for (const user of users) {
    userMap.set(user.id, user);
  }

  const eventSub = createEventSubConnection(
    TWITCH_CLIENT_ID,
    () => getTwitchToken(TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET),
    {
      onConnected: async () => {
        console.log("EventSub connected, subscribing to channels...");
        for (const user of users) {
          await eventSub.subscribe(user.id);
        }
      },
      onStreamOffline: (userId: string, userLogin: string) => {
        const user = userMap.get(userId);
        console.log(`Stream went offline: ${user?.displayName || userLogin}`);
        startVODPolling(userId, userLogin);
      },
      onError: (error: Error) => {
        console.error("EventSub error:", error.message);
      },
    }
  );

  eventSub.connect();

  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    eventSub.close();
    for (const [userId] of pendingChecks) {
      stopVODPolling(userId);
    }
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    eventSub.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
