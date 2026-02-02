"use client";

import { useState, useEffect, useRef } from "react";
import type { TwitchVod } from "@/lib/types";
import { deleteVod, type ApiError } from "@/lib/api";
import { Card, Button, ConfirmDialog } from "@/components/ui";
import { useDownload } from "@/context/DownloadContext";

type VodCardProps = {
  vod: TwitchVod;
  onDownloadComplete: () => void;
  onDelete?: () => void;
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

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
    >
      <path
        fillRule="evenodd"
        d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function VodCard({ vod, onDownloadComplete, onDelete }: VodCardProps) {
  const { isDownloading, progress, error, startDownload, cancelDownload } = useDownload(vod.id);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const wasDownloadingRef = useRef(isDownloading);

  useEffect(() => {
    if (wasDownloadingRef.current && !isDownloading && !error) {
      onDownloadComplete();
    }
    wasDownloadingRef.current = isDownloading;
  }, [isDownloading, error, onDownloadComplete]);

  const handleDownload = () => {
    startDownload();
  };

  const handleCancel = () => {
    cancelDownload();
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteVod(vod.id);
      setShowDeleteConfirm(false);
      onDelete?.();
    } catch (err) {
      const apiError = err as ApiError;
      setDeleteError(apiError.message || "Delete failed");
    } finally {
      setIsDeleting(false);
    }
  };

  const displayError = error || deleteError;

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

        {displayError && (
          <p className="text-red-400 text-xs mb-2">{displayError}</p>
        )}

        {isDownloading && progress ? (
          <div className="space-y-3">
            {progress.stage === "queued" ? (
              <div className="flex items-center justify-between text-xs">
                <span className="text-amber-400">{progress.message}</span>
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Video</span>
                    <span className="text-zinc-400">{progress.videoPercent}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${progress.videoPercent}%` }}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Chat</span>
                    <span className="text-zinc-400">{progress.chatPercent}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500 transition-all duration-300"
                      style={{ width: `${progress.chatPercent}%` }}
                    />
                  </div>
                </div>
              </>
            )}

            <Button
              variant="secondary"
              size="sm"
              onClick={handleCancel}
              className="w-full"
            >
              Cancel
            </Button>
          </div>
        ) : vod.downloaded ? (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled className="flex-1">
              Downloaded
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
              className="px-3 text-red-400 hover:text-red-300 hover:bg-red-500/10"
            >
              <TrashIcon className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={handleDownload} className="w-full">
            Download
          </Button>
        )}
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete VOD"
        message="Delete this VOD and its chat log? This cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        isLoading={isDeleting}
      />
    </Card>
  );
}
