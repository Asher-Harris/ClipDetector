"use client";

import { useEffect, useRef } from "react";
import { type ClipWithStatus } from "@/lib/types";
import { ClipCard } from "./ClipCard";

interface ClipListProps {
  clips: ClipWithStatus[];
  selectedClipId: string | null;
  onSelectClip: (id: string) => void;
  onReset: (id: string) => void;
}

export function ClipList({
  clips,
  selectedClipId,
  onSelectClip,
  onReset,
}: ClipListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Sort by score descending
  const sortedClips = [...clips].sort((a, b) => b.score - a.score);

  // Scroll selected clip into view when selection changes
  useEffect(() => {
    if (!selectedClipId || !scrollContainerRef.current) return;

    const selectedElement = scrollContainerRef.current.querySelector(
      `[data-clip-id="${selectedClipId}"]`
    );

    if (selectedElement) {
      selectedElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [selectedClipId]);

  const editedCount = clips.filter(
    (c) => c.trimStart !== c.clip_start || c.trimEnd !== c.clip_end
  ).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="pb-4 border-b border-zinc-800 mb-4">
        <h2 className="text-lg font-semibold mb-2">Clip Candidates</h2>
        <div className="flex gap-4 text-sm text-zinc-400">
          <span>{clips.length} total</span>
          <span className="text-green-400">{editedCount} edited</span>
        </div>
      </div>

      {/* Clip List */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto space-y-3 pr-2">
        {sortedClips.map((clip) => (
          <div key={clip.id} data-clip-id={clip.id}>
            <ClipCard
              clip={clip}
              isSelected={clip.id === selectedClipId}
              onSelect={() => onSelectClip(clip.id)}
              onReset={() => onReset(clip.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
