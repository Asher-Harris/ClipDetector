import type { VODInfo } from "./discord";

const OPENCLAW_WEBHOOK_URL = process.env.OPENCLAW_WEBHOOK_URL;
const OPENCLAW_WEBHOOK_TOKEN = process.env.OPENCLAW_WEBHOOK_TOKEN;

export async function triggerOpenClawWebhook(vod: VODInfo): Promise<boolean> {
  if (!OPENCLAW_WEBHOOK_URL || !OPENCLAW_WEBHOOK_TOKEN) {
    return false;
  }

  const agentPrompt = [
    `A new VOD was just published by ${vod.streamerName}: "${vod.title}" (${vod.duration}).`,
    `Process this VOD and deliver any clips to Telegram.`,
    ``,
    `1. Trigger the pipeline: curl -sX POST http://localhost:8000/api/automation/run`,
    `2. Poll status every 30 seconds until done: curl -s http://localhost:8000/api/automation/status`,
    `   Wait until "is_running" is false before continuing.`,
    `3. Fetch ready clips: curl -s http://localhost:8000/api/automation/ready-clips`,
    `   If the response is an empty array, stop — there's nothing to deliver.`,
    `4. For each clip, send it to Telegram using the message tool with:`,
    `   - media: the clip's "url" field (e.g. http://localhost:8000/data/clips/AbCdEfGh_vertical.mp4)`,
    `   - text: "{channel} — {vod_title}"`,
    `5. After each successful send, mark it delivered: curl -sX POST http://localhost:8000/api/automation/clips/{filename}/delivered`,
    `6. After all clips are sent and marked, clean up disk space: curl -sX POST http://localhost:8000/api/automation/cleanup-delivered`,
  ].join("\n");

  try {
    const response = await fetch(`${OPENCLAW_WEBHOOK_URL}/hooks/agent`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENCLAW_WEBHOOK_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: agentPrompt,
        name: "ClipDetector",
        deliver: false,
        channel: "telegram",
        timeoutSeconds: 1800,
      }),
    });

    if (response.status === 202) {
      console.log(`OpenClaw webhook triggered for VOD ${vod.id}`);
      return true;
    }

    console.error(`OpenClaw webhook returned ${response.status}: ${await response.text()}`);
    return false;
  } catch (error) {
    console.error(`OpenClaw webhook failed:`, error);
    return false;
  }
}
