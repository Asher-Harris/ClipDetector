"use client";

import { useEffect, useRef } from "react";
import { type ClipWithStatus } from "@/lib/types";
import { ClipCard } from "./ClipCard";
import { ExportButton } from "./ExportButton";

interface ClipListProps {
  clips: ClipWithStatus[];
  selectedClipId: string | null;
  onSelectClip: (id: string) => void;
  onReset: (id: string) => void;
  vodFilename: string;
  vodPath: string;
  editedClips: ClipWithStatus[];
}

export function ClipList({
  clips,
  selectedClipId,
  onSelectClip,
  onReset,
  vodFilename,
  vodPath,
  editedClips,
}: ClipListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const sortedClips = [...clips].sort((a, b) => b.score - a.score);

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

  return (
    <div className="flex flex-col h-full bg-bg-surface border border-border-default rounded-lg overflow-hidden">
      <div className="p-4 border-b border-border-subtle">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-medium text-fg-default">Clips</h2>
            <p className="text-xs text-fg-muted mt-0.5 font-mono truncate max-w-[180px]" title={vodFilename}>
              {vodFilename}
            </p>
          </div>
          <div className="flex items-baseline gap-3 text-xs">
            <span className="text-fg-muted">{clips.length} found</span>
            {editedClips.length > 0 && (
              <span className="text-accent font-medium">{editedClips.length} edited</span>
            )}
          </div>
        </div>
        <ExportButton
          clips={editedClips}
          vodFilename={vodFilename}
          vodPath={vodPath}
        />
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-2 space-y-2">
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
