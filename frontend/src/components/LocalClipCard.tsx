"use client";

import { useRef, useCallback } from "react";
import type { LocalClip } from "@/lib/types";
import { getClipUrl } from "@/lib/api";

type LocalClipCardProps = {
  clip: LocalClip;
  onPlay: (clip: LocalClip) => void;
  onDelete: (clip: LocalClip) => void;
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `0:${s.toString().padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11.04-6.86a1 1 0 0 0 0-1.72L9.5 4.28a1 1 0 0 0-1.5.86Z"/>
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

export function LocalClipCard({ clip, onPlay, onDelete }: LocalClipCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = Math.min(1, video.duration / 2);
    }
  }, []);

  return (
    <div className="group flex flex-col bg-bg-surface rounded-lg border border-border-default hover:border-border-strong transition-colors overflow-hidden">
      <div
        className="relative aspect-video bg-bg-overlay cursor-pointer"
        onClick={() => onPlay(clip)}
      >
        <video
          ref={videoRef}
          src={getClipUrl(`clips/${clip.filename}`)}
          preload="metadata"
          muted
          className="w-full h-full object-cover"
          onLoadedMetadata={handleLoadedMetadata}
        />
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-10 h-10 flex items-center justify-center rounded-full bg-black/60">
            <PlayIcon className="w-5 h-5 text-white ml-0.5" />
          </div>
        </div>
        {clip.duration > 0 && (
          <div className="absolute bottom-2 left-2">
            <span className="text-[11px] font-medium text-white/90 bg-black/50 px-1.5 py-0.5 rounded">
              {formatDuration(clip.duration)}
            </span>
          </div>
        )}
      </div>

      <div className="p-3 flex flex-col flex-1">
        <h3
          className="text-[13px] font-medium text-fg-default line-clamp-2 leading-snug mb-2"
          title={clip.filename}
        >
          {clip.filename}
        </h3>

        <div className="flex items-center gap-2 text-[11px] text-fg-muted">
          <span className="tabular-nums">{formatFileSize(clip.file_size)}</span>
          <span className="text-fg-faint">·</span>
          <span>{formatDate(clip.created_at)}</span>
        </div>

        <div className="mt-auto pt-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(clip);
            }}
            className="w-full h-7 flex items-center justify-center gap-1.5 text-[12px] font-medium text-fg-muted hover:text-error bg-bg-overlay hover:bg-error-muted rounded-md transition-colors"
          >
            <TrashIcon className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
