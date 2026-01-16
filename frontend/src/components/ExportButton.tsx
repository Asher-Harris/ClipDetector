"use client";

import { type ClipWithStatus } from "@/lib/types";
import { Button } from "./ui";

interface ExportButtonProps {
  clips: ClipWithStatus[];
  vodFilename: string;
}

export function ExportButton({ clips, vodFilename }: ExportButtonProps) {
  const approvedClips = clips.filter((c) => c.status === "approved");

  const handleExport = () => {
    const exportData = {
      vod: vodFilename,
      exported_at: new Date().toISOString(),
      clips: approvedClips.map((clip) => ({
        id: clip.id,
        original_timestamp: clip.timestamp,
        original_start: clip.clip_start,
        original_end: clip.clip_end,
        trimmed_start: clip.trimStart,
        trimmed_end: clip.trimEnd,
        duration: clip.trimEnd - clip.trimStart,
        score: clip.score,
        signals: clip.signals,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clips_${vodFilename.replace(/\.[^/.]+$/, "")}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Button
      variant="primary"
      onClick={handleExport}
      disabled={approvedClips.length === 0}
    >
      Export {approvedClips.length} Clip{approvedClips.length !== 1 ? "s" : ""}
    </Button>
  );
}
