"use client";

import type { TwitchVod } from "@/lib/types";

type VodSelectorProps = {
  vods: TwitchVod[];
  selectedVodId: string | null;
  onSelect: (vodId: string) => void;
  disabled?: boolean;
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

function formatViewCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(0)}K`;
  }
  return count.toString();
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

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3.5 8.5 6 11l6.5-6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function VodSelector({ vods, selectedVodId, onSelect, disabled }: VodSelectorProps) {
  if (vods.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-fg-muted text-sm">No downloaded VODs available</p>
        <p className="text-fg-faint text-xs mt-1">
          Go to the VODs page to download content
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {vods.map((vod) => {
        const isSelected = vod.id === selectedVodId;
        return (
          <button
            key={vod.id}
            onClick={() => onSelect(vod.id)}
            disabled={disabled}
            className={`
              relative flex gap-3 p-2 rounded-lg border text-left transition-all
              ${isSelected
                ? "border-accent bg-accent/5 ring-1 ring-accent/30"
                : "border-border-default bg-bg-surface hover:border-border-strong hover:bg-bg-hover"
              }
              ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}
            `}
          >
            {/* Thumbnail */}
            <div className="relative flex-shrink-0 w-28 aspect-video rounded overflow-hidden bg-bg-overlay">
              <img
                src={vod.thumbnail_url}
                alt=""
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-1 left-1 text-[10px] font-medium text-white bg-black/60 px-1 py-0.5 rounded">
                {formatDuration(vod.duration)}
              </div>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0 py-0.5">
              <h4 className="text-[13px] font-medium text-fg-default line-clamp-2 leading-tight mb-1.5" title={vod.title}>
                {vod.title}
              </h4>
              <div className="flex items-center gap-1.5 mb-1">
                {vod.channel_profile_image_url && (
                  <img
                    src={vod.channel_profile_image_url}
                    alt=""
                    className="w-4 h-4 rounded-full"
                  />
                )}
                <span className="text-[11px] font-medium text-fg-secondary">
                  {vod.channel_display_name || vod.channel_login}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-fg-muted">
                <span className="tabular-nums">{formatViewCount(vod.view_count)} views</span>
                <span className="text-fg-faint">·</span>
                <span>{formatDate(vod.created_at)}</span>
              </div>
            </div>

            {/* Selection indicator */}
            {isSelected && (
              <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                <CheckIcon className="w-3 h-3 text-white" />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
