"use client";

import { type ClipWithStatus, type SignalType } from "@/lib/types";
import { formatTimeRange, formatDuration } from "@/lib/format";
import { Badge } from "./ui";

interface ClipCardProps {
  clip: ClipWithStatus;
  isSelected: boolean;
  onSelect: () => void;
  onReset: () => void;
}

export function ClipCard({
  clip,
  isSelected,
  onSelect,
  onReset,
}: ClipCardProps) {
  const duration = clip.trimEnd - clip.trimStart;
  const isModified = clip.trimStart !== clip.clip_start || clip.trimEnd !== clip.clip_end;

  return (
    <div
      className={`
        relative p-3 rounded-lg cursor-pointer transition-all
        ${isSelected
          ? "bg-accent/10 ring-1 ring-accent"
          : "bg-bg-overlay/50 hover:bg-bg-hover"
        }
      `}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-fg-default">
              {formatTimeRange(clip.trimStart, clip.trimEnd)}
            </span>
            {isModified && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-accent/15 text-accent rounded">
                edited
              </span>
            )}
          </div>
          <div className="text-xs text-fg-muted mt-1">
            {formatDuration(duration)}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isModified && (
            <button
              className="p-1 text-fg-faint hover:text-fg-secondary rounded transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onReset();
              }}
              title="Reset to original"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
          )}
          <div className="text-right">
            <div className="text-base font-semibold tabular-nums text-fg-default">
              {clip.score.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 mt-2">
        {Object.entries(
          clip.signals.reduce<Record<string, number>>((acc, signal) => {
            acc[signal] = (acc[signal] || 0) + 1;
            return acc;
          }, {})
        ).map(([signal, count]) => (
          <Badge key={signal} signal={signal as SignalType} count={count} />
        ))}
      </div>
    </div>
  );
}
