"use client";

import { type ClipWithStatus, type SignalType } from "@/lib/types";
import { formatTimeRange, formatDuration } from "@/lib/format";
import { Badge, Card, Button } from "./ui";

interface ClipCardProps {
  clip: ClipWithStatus;
  isSelected: boolean;
  onSelect: () => void;
  onApprove: () => void;
  onReject: () => void;
}

export function ClipCard({
  clip,
  isSelected,
  onSelect,
  onApprove,
  onReject,
}: ClipCardProps) {
  const duration = clip.trimEnd - clip.trimStart;
  const isModified = clip.trimStart !== clip.clip_start || clip.trimEnd !== clip.clip_end;

  return (
    <Card
      selected={isSelected}
      className={`p-4 cursor-pointer transition-all ${
        clip.status === "approved"
          ? "border-green-600/50 bg-green-950/20"
          : clip.status === "rejected"
          ? "border-red-600/50 bg-red-950/20 opacity-60"
          : ""
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
      <div className="flex flex-wrap gap-1.5 mb-3">
        {Object.entries(
          clip.signals.reduce<Record<string, number>>((acc, signal) => {
            acc[signal] = (acc[signal] || 0) + 1;
            return acc;
          }, {})
        ).map(([signal, count]) => (
          <Badge key={signal} signal={signal as SignalType} count={count} />
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
        <Button
          size="sm"
          variant={clip.status === "approved" ? "primary" : "ghost"}
          onClick={onApprove}
          className={clip.status === "approved" ? "bg-green-600 hover:bg-green-700" : ""}
        >
          {clip.status === "approved" ? "Approved" : "Approve"}
        </Button>
        <Button
          size="sm"
          variant={clip.status === "rejected" ? "danger" : "ghost"}
          onClick={onReject}
        >
          {clip.status === "rejected" ? "Rejected" : "Reject"}
        </Button>
      </div>
    </Card>
  );
}
