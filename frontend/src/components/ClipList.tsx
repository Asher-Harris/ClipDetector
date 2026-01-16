"use client";

import { type ClipWithStatus } from "@/lib/types";
import { ClipCard } from "./ClipCard";

interface ClipListProps {
  clips: ClipWithStatus[];
  selectedClipId: string | null;
  onSelectClip: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

export function ClipList({
  clips,
  selectedClipId,
  onSelectClip,
  onApprove,
  onReject,
}: ClipListProps) {
  // Sort by score descending
  const sortedClips = [...clips].sort((a, b) => b.score - a.score);

  const approvedCount = clips.filter((c) => c.status === "approved").length;
  const rejectedCount = clips.filter((c) => c.status === "rejected").length;
  const pendingCount = clips.filter((c) => c.status === "pending").length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="pb-4 border-b border-zinc-800 mb-4">
        <h2 className="text-lg font-semibold mb-2">Clip Candidates</h2>
        <div className="flex gap-4 text-sm text-zinc-400">
          <span>{clips.length} total</span>
          <span className="text-green-400">{approvedCount} approved</span>
          <span className="text-red-400">{rejectedCount} rejected</span>
          <span>{pendingCount} pending</span>
        </div>
      </div>

      {/* Clip List */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-2">
        {sortedClips.map((clip) => (
          <ClipCard
            key={clip.id}
            clip={clip}
            isSelected={clip.id === selectedClipId}
            onSelect={() => onSelectClip(clip.id)}
            onApprove={() => onApprove(clip.id)}
            onReject={() => onReject(clip.id)}
          />
        ))}
      </div>
    </div>
  );
}
