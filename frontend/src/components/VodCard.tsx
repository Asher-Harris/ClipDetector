"use client";

/* eslint-disable @next/next/no-img-element -- Twitch CDN URLs are dynamic and intentionally bypass Next's image proxy. */

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type { TwitchVod } from "@/lib/types";
import { deleteVod, type ApiError } from "@/lib/api";
import { ConfirmDialog } from "@/components/ui";
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
  const now = new Date();
  const diffTime = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatViewCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(0)}K`;
  }
  return count.toString();
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 1v9m0 0L5 7m3 3 3-3M3 14h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3.5 8.5 6 11l6.5-6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 0 1 1.334-1.334h2.666a1.333 1.333 0 0 1 1.334 1.334V4m2 0v9.333a1.333 1.333 0 0 1-1.334 1.334H4.667a1.333 1.333 0 0 1-1.334-1.334V4h9.334z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
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
  const totalProgress = progress ? Math.round((progress.videoPercent + progress.chatPercent) / 2) : 0;

  return (
    <div className="group h-full flex flex-col bg-bg-surface rounded-lg border border-border-default hover:border-border-strong transition-colors overflow-hidden">
      <Link href={`/vods/${vod.id}/clips`} className="block">
        <div className="relative aspect-video bg-bg-overlay">
          <img
            src={vod.thumbnail_url}
            alt=""
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between">
            <span className="text-[11px] font-medium text-white/90 bg-black/50 px-1.5 py-0.5 rounded">
              {formatDuration(vod.duration)}
            </span>
            {vod.downloaded && (
              <span className="flex items-center gap-1 text-[11px] font-medium text-success bg-black/50 px-1.5 py-0.5 rounded">
                <CheckIcon className="w-3 h-3" />
                Ready
              </span>
            )}
          </div>
        </div>
      </Link>

      <div className="p-3 flex flex-col flex-1">
        <h3 className="text-[13px] font-medium text-fg-default line-clamp-2 leading-snug mb-2" title={vod.title}>
          {vod.title}
        </h3>

        <div className="flex items-center gap-2 text-[11px] text-fg-muted">
          {vod.channel_profile_image_url && (
            <img
              src={vod.channel_profile_image_url}
              alt=""
              className="w-4 h-4 rounded-full flex-shrink-0"
            />
          )}
          <span className="font-medium text-fg-secondary">
            {vod.channel_display_name || vod.channel_login}
          </span>
          <span className="text-fg-faint">·</span>
          <span className="tabular-nums">{formatViewCount(vod.view_count)} views</span>
          <span className="text-fg-faint">·</span>
          <span>{formatDate(vod.created_at)}</span>
        </div>

        <div className="mt-auto pt-3">
        {displayError && (
          <p className="text-[11px] text-error mb-2 bg-error-muted px-2 py-1 rounded">{displayError}</p>
        )}

        {isDownloading && progress ? (
          <div className="space-y-2">
            {progress.stage === "queued" ? (
              <div className="text-[11px] text-warning bg-warning-muted px-2 py-1.5 rounded">
                {progress.message}
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-fg-muted">Downloading</span>
                  <span className="text-fg-secondary font-medium tabular-nums">{totalProgress}%</span>
                </div>
                <div className="h-1 bg-bg-overlay rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all duration-300 ease-out"
                    style={{ width: `${totalProgress}%` }}
                  />
                </div>
                <div className="flex items-center gap-3 text-[10px] text-fg-muted">
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                    Video {progress.videoPercent}%
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-info" />
                    Chat {progress.chatPercent}%
                  </span>
                </div>
              </div>
            )}
            <button
              onClick={handleCancel}
              className="w-full h-7 flex items-center justify-center gap-1.5 text-[12px] font-medium text-fg-secondary hover:text-fg-default bg-bg-overlay hover:bg-bg-hover rounded-md transition-colors"
            >
              <XIcon className="w-3.5 h-3.5" />
              Cancel
            </button>
          </div>
        ) : vod.downloaded ? (
          <div className="flex gap-2">
            <div className="flex-1 h-7 flex items-center justify-center gap-1.5 text-[12px] font-medium text-fg-muted bg-bg-overlay rounded-md">
              <CheckIcon className="w-3.5 h-3.5" />
              Downloaded
            </div>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-7 h-7 flex items-center justify-center text-fg-muted hover:text-error hover:bg-error-muted rounded-md transition-colors"
            >
              <TrashIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={handleDownload}
            className="w-full h-7 flex items-center justify-center gap-1.5 text-[12px] font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors"
          >
            <DownloadIcon className="w-3.5 h-3.5" />
            Download
          </button>
        )}
        </div>
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
    </div>
  );
}
