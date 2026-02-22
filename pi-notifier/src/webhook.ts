import type { VODInfo } from "./discord";

const CLIPDETECTOR_URL = process.env.CLIPDETECTOR_URL;

export async function triggerClipDetectorPipeline(vod: VODInfo): Promise<boolean> {
  if (!CLIPDETECTOR_URL) {
    return false;
  }

  try {
    const response = await fetch(`${CLIPDETECTOR_URL}/api/automation/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`ClipDetector pipeline triggered for VOD ${vod.id}: ${data.message}`);
      return true;
    }

    console.error(`ClipDetector pipeline returned ${response.status}: ${await response.text()}`);
    return false;
  } catch (error) {
    console.error(`ClipDetector pipeline trigger failed:`, error);
    return false;
  }
}
