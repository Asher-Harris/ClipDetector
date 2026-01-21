"use client";

import { type ClipWithStatus, type SignalType } from "@/lib/types";
import { formatTimeRange, formatDuration } from "@/lib/format";
import { Badge, Card } from "./ui";

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
    <Card
      selected={isSelected}
      className={`p-4 cursor-pointer transition-all relative ${
        isModified ? "border-green-600/50 bg-green-950/20" : ""
      }`}
      onClick={onSelect}
    >
      {/* Header: Time Range and Score */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-mono text-sm text-white">
            {formatTimeRange(clip.trimStart, clip.trimEnd)}
            {isModified && (
              <span className="ml-2 text-xs text-yellow-500">(edited)</span>
            )}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">
            {formatDuration(duration)} clip
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold text-blue-400">
            {clip.score.toFixed(2)}
          </div>
          <div className="text-xs text-zinc-500">score</div>
        </div>
      </div>

      {/* Signal Badges */}
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(
          clip.signals.reduce<Record<string, number>>((acc, signal) => {
            acc[signal] = (acc[signal] || 0) + 1;
            return acc;
          }, {})
        ).map(([signal, count]) => (
          <Badge key={signal} signal={signal as SignalType} count={count} />
        ))}
      </div>

      {/* Reset Icon */}
      {isModified && (
        <button
          className="absolute bottom-3 right-3 p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onReset();
          }}
          title="Reset to original times"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
      )}
    </Card>
  );
}
