"use client";

import { useState } from "react";
import type { TwitchVod, DownloadProgress } from "@/lib/types";
import { downloadVodWithProgress, type ApiError } from "@/lib/api";
import { Card, Button } from "@/components/ui";

type VodCardProps = {
  vod: TwitchVod;
  onDownloadComplete: () => void;
};

function formatDuration(duration: string): string {
  const match = duration.match(/(\d+)h(\d+)m(\d+)s/);
  if (match) {
    const [, h, m] = match;
    return `${h}h ${m}m`;
  }
  const minMatch = duration.match(/(\d+)m(\d+)s/);
  if (minMatch) {
    return `${minMatch[1]}m`;
  }
  return duration;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatViewCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}

export function VodCard({ vod, onDownloadComplete }: VodCardProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setIsDownloading(true);
    setError(null);
    setProgress(null);

    try {
      await downloadVodWithProgress(vod.id, setProgress);
      onDownloadComplete();
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message || "Download failed");
    } finally {
      setIsDownloading(false);
      setProgress(null);
    }
  };

  const overallProgress = progress
    ? progress.stage === "video"
      ? Math.floor(progress.percent / 2)
      : 50 + Math.floor(progress.percent / 2)
    : 0;

  return (
    <Card className="overflow-hidden">
      <div className="relative">
        <img
          src={vod.thumbnail_url}
          alt={vod.title}
          className="w-full aspect-video object-cover"
        />
        <div className="absolute bottom-2 right-2 bg-black/80 px-2 py-1 rounded text-xs font-medium">
          {formatDuration(vod.duration)}
        </div>
        {vod.downloaded && (
          <div className="absolute top-2 left-2 bg-green-600 px-2 py-1 rounded text-xs font-medium">
            Downloaded
          </div>
        )}
      </div>

      <div className="p-4">
        <div className="text-xs text-zinc-400 mb-1">
          {vod.channel_login}
        </div>
        <h3 className="font-medium text-sm line-clamp-2 mb-2" title={vod.title}>
          {vod.title}
        </h3>

        <div className="flex items-center gap-3 text-xs text-zinc-400 mb-3">
          <span>{formatViewCount(vod.view_count)} views</span>
          <span>{formatDate(vod.created_at)}</span>
        </div>

        {error && (
          <p className="text-red-400 text-xs mb-2">{error}</p>
        )}

        {isDownloading ? (
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-300">{progress?.message || "Starting..."}</span>
              <span className="text-zinc-400">{overallProgress}%</span>
            </div>
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
          </div>
        ) : vod.downloaded ? (
          <Button variant="secondary" size="sm" disabled className="w-full">
            Downloaded
          </Button>
        ) : (
          <Button size="sm" onClick={handleDownload} className="w-full">
            Download
          </Button>
        )}
      </div>
    </Card>
  );
}
