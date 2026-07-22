"use client";

import { useEffect } from "react";
import type { TwitchClip } from "@/lib/types";
import { getClipUrl } from "@/lib/api";

type PlayableClip = {
  filename: string;
  title: string;
  duration: number;
  creator_name?: string;
  view_count?: number;
};

type ClipPlayerModalProps = {
  clip: TwitchClip | PlayableClip | null;
  onClose: () => void;
};

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

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

export function ClipPlayerModal({ clip, onClose }: ClipPlayerModalProps) {
  const embedParent =
    typeof window === "undefined" ? "localhost" : window.location.hostname;
  useEffect(() => {
    if (!clip) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [clip, onClose]);

  if (!clip) return null;

  const isTwitchClip = "id" in clip && "downloaded" in clip;
  const twitchClip = isTwitchClip ? (clip as TwitchClip) : null;
  const isDownloaded = twitchClip ? twitchClip.downloaded && twitchClip.filename : true;
  const videoSrc = clip.filename ? getClipUrl(`clips/${clip.filename}`) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay-bg animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-3xl mx-4 bg-bg-surface rounded-lg border border-border-default shadow-xl animate-scale-in overflow-hidden">
        <div className="relative">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/60 text-white/80 hover:text-white hover:bg-black/80 transition-colors"
          >
            <CloseIcon className="w-4 h-4" />
          </button>

          <div className="aspect-video bg-black">
            {isDownloaded && videoSrc ? (
              <video
                controls
                autoPlay
                className="w-full h-full"
                src={videoSrc}
              />
            ) : twitchClip ? (
              <iframe
                src={`https://clips.twitch.tv/embed?clip=${twitchClip.id}&parent=${encodeURIComponent(embedParent)}`}
                className="w-full h-full"
                allowFullScreen
              />
            ) : null}
          </div>
        </div>

        <div className="p-4">
          <h3 className="text-sm font-medium text-fg-default line-clamp-2 leading-snug">
            {clip.title}
          </h3>
          <div className="flex items-center gap-2 mt-1.5 text-[11px] text-fg-muted">
            {clip.creator_name && (
              <>
                <span className="font-medium text-fg-secondary">{clip.creator_name}</span>
                <span className="text-fg-faint">·</span>
              </>
            )}
            {clip.view_count != null && (
              <>
                <span className="tabular-nums">{formatViewCount(clip.view_count)} views</span>
                <span className="text-fg-faint">·</span>
              </>
            )}
            <span className="tabular-nums">{formatDuration(clip.duration)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
