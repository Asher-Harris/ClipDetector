"use client";

import { useState, useEffect } from "react";
import { type ClipWithStatus, type ExportResult } from "@/lib/types";
import { exportClip, generateTTS, type ApiError } from "@/lib/api";
import { Button, Spinner } from "./ui";

interface ExportButtonProps {
  clips: ClipWithStatus[];
  vodFilename: string;
  vodPath: string;
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}h${m.toString().padStart(2, "0")}m${s.toString().padStart(2, "0")}s`;
  }
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function generateFilename(vodFilename: string, clip: ClipWithStatus): string {
  const vodBase = vodFilename.replace(/\.[^/.]+$/, "");
  const timestamp = formatTimestamp(clip.trimStart);
  const score = Math.round(clip.score * 100);
  return `${vodBase}_${timestamp}_score${score}.mp4`;
}

function generateIntroFilename(vodFilename: string, clip: ClipWithStatus): string {
  const vodBase = vodFilename.replace(/\.[^/.]+$/, "");
  const timestamp = formatTimestamp(clip.trimStart);
  return `${vodBase}_${timestamp}_intro.mp3`;
}

export function ExportButton({ clips, vodFilename, vodPath }: ExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [results, setResults] = useState<ExportResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const clipsToExport = clips;

  const handleExport = async () => {
    if (clipsToExport.length === 0) return;

    setIsExporting(true);
    setResults([]);
    setCurrentIndex(0);

    const exportResults: ExportResult[] = [];

    // Export clips in parallel (batches of 3 to avoid overwhelming the system)
    const batchSize = 3;
    for (let i = 0; i < clipsToExport.length; i += batchSize) {
      const batch = clipsToExport.slice(i, i + batchSize);
      setCurrentIndex(i);

      const batchPromises = batch.map(async (clip) => {
        const filename = generateFilename(vodFilename, clip);
        let introPath: string | undefined;
        let introVideoPath: string | undefined;

        try {
          const response = await exportClip({
            vod_path: vodPath,
            start_time: clip.trimStart,
            end_time: clip.trimEnd,
            output_filename: filename,
          });

          if (clip.ttsSettings?.text?.trim()) {
            const introFilename = generateIntroFilename(vodFilename, clip);
            const ttsResponse = await generateTTS({
              text: clip.ttsSettings.text,
              voice: clip.ttsSettings.voice,
              speed: clip.ttsSettings.speed,
              output_filename: introFilename,
              avatar: clip.ttsSettings.avatar,
            });
            introPath = ttsResponse.output_path;
            if (ttsResponse.video_path) {
              introVideoPath = ttsResponse.video_path;
            }
          }

          return {
            clipId: clip.id,
            status: "success" as const,
            outputPath: response.output_path,
            introPath,
            introVideoPath,
          };
        } catch (err) {
          const apiError = err as ApiError;
          return {
            clipId: clip.id,
            status: "error" as const,
            error: apiError.message || "Export failed",
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      exportResults.push(...batchResults);
      setResults([...exportResults]);
    }

    setIsExporting(false);
  };

  const successCount = results.filter((r) => r.status === "success").length;
  const introCount = results.filter((r) => r.introPath).length;
  const videoCount = results.filter((r) => r.introVideoPath).length;
  const errorCount = results.filter((r) => r.status === "error").length;

  // Auto-dismiss results after 4 seconds
  useEffect(() => {
    if (results.length > 0 && !isExporting) {
      const timer = setTimeout(() => setResults([]), 4000);
      return () => clearTimeout(timer);
    }
  }, [results, isExporting]);

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="primary"
        onClick={handleExport}
        disabled={clipsToExport.length === 0 || isExporting}
      >
        {isExporting ? (
          <span className="flex items-center gap-2">
            <Spinner size="sm" />
            Exporting {Math.min(currentIndex + 3, clipsToExport.length)}/{clipsToExport.length}...
          </span>
        ) : (
          `Export ${clipsToExport.length} Clip${clipsToExport.length !== 1 ? "s" : ""}`
        )}
      </Button>

      {results.length > 0 && !isExporting && (
        <p className="text-sm">
          {successCount > 0 && (
            <span className="text-green-500">
              ✓ {successCount} clip{successCount !== 1 ? "s" : ""} exported
              {introCount > 0 && ` (${introCount} with intro${videoCount > 0 ? `, ${videoCount} with video` : ""})`}
            </span>
          )}
          {successCount > 0 && errorCount > 0 && " · "}
          {errorCount > 0 && (
            <span className="text-red-500">
              ✗ {errorCount} failed
            </span>
          )}
        </p>
      )}
    </div>
  );
}
