"use client";

import { useState } from "react";
import type { TwitchClip } from "@/lib/types";
import { downloadTwitchClip, type ApiError } from "@/lib/api";
import { Spinner } from "@/components/ui";

type TwitchClipCardProps = {
  clip: TwitchClip;
  channelLogin: string;
  onDownloaded: () => void;
  onPlay: (clip: TwitchClip) => void;
  onDelete?: (clip: TwitchClip) => void;
};

function formatViewCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}K`;
  return count.toString();
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `0:${s.toString().padStart(2, "0")}`;
}

function formatVodOffset(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
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

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11.04-6.86a1 1 0 0 0 0-1.72L9.5 4.28a1 1 0 0 0-1.5.86Z"/>
    </svg>
  );
}

export function TwitchClipCard({ clip, channelLogin, onDownloaded, onPlay, onDelete }: TwitchClipCardProps) {
  const [downloadState, setDownloadState] = useState<"idle" | "downloading" | "downloaded">(
    clip.downloaded ? "downloaded" : "idle"
  );
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setDownloadState("downloading");
    setError(null);
    try {
      await downloadTwitchClip(clip.id, channelLogin);
      setDownloadState("downloaded");
      onDownloaded();
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message || "Download failed");
      setDownloadState("idle");
    }
  };

  return (
    <div className="group flex flex-col bg-bg-surface rounded-lg border border-border-default hover:border-border-strong transition-colors overflow-hidden">
      <div className="relative aspect-video bg-bg-overlay cursor-pointer" onClick={() => onPlay(clip)}>
        {clip.thumbnail_url ? (
          <img src={clip.thumbnail_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-fg-faint text-[11px]">
            No thumbnail
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-10 h-10 flex items-center justify-center rounded-full bg-black/60">
            <PlayIcon className="w-5 h-5 text-white ml-0.5" />
          </div>
        </div>
        <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between">
          <span className="text-[11px] font-medium text-white/90 bg-black/50 px-1.5 py-0.5 rounded">
            {formatDuration(clip.duration)}
          </span>
          {clip.vod_offset != null && (
            <span className="text-[11px] font-medium text-white/70 bg-black/50 px-1.5 py-0.5 rounded tabular-nums">
              {formatVodOffset(clip.vod_offset)}
            </span>
          )}
        </div>
      </div>

      <div className="p-3 flex flex-col flex-1">
        <h3 className="text-[13px] font-medium text-fg-default line-clamp-2 leading-snug mb-2" title={clip.title}>
          {clip.title}
        </h3>

        <div className="flex items-center gap-2 text-[11px] text-fg-muted">
          <span className="font-medium text-fg-secondary">{clip.creator_name}</span>
          <span className="text-fg-faint">·</span>
          <span className="tabular-nums">{formatViewCount(clip.view_count)} views</span>
        </div>

        <div className="mt-auto pt-3">
          {error && (
            <p className="text-[11px] text-error mb-2 bg-error-muted px-2 py-1 rounded">{error}</p>
          )}

          {downloadState === "downloading" ? (
            <div className="w-full h-7 flex items-center justify-center gap-1.5 text-[12px] font-medium text-fg-muted bg-bg-overlay rounded-md">
              <Spinner size="sm" />
              Downloading
            </div>
          ) : downloadState === "downloaded" ? (
            <div className="flex items-center gap-1.5">
              <div className="flex-1 h-7 flex items-center justify-center gap-1.5 text-[12px] font-medium text-fg-muted bg-bg-overlay rounded-md">
                <CheckIcon className="w-3.5 h-3.5" />
                Downloaded
              </div>
              {onDelete && (
                <button
                  onClick={() => onDelete(clip)}
                  className="h-7 w-7 flex-shrink-0 flex items-center justify-center text-fg-faint hover:text-error bg-bg-overlay hover:bg-error-muted rounded-md transition-colors"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                </button>
              )}
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
    </div>
  );
}
