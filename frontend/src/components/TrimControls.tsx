"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { formatTime } from "@/lib/format";
import { Button } from "./ui";

interface TrimControlsProps {
  originalStart: number;
  originalEnd: number;
  trimStart: number;
  trimEnd: number;
  duration: number;
  currentTime: number;
  onTrimStartChange: (time: number) => void;
  onTrimEndChange: (time: number) => void;
  onSeek: (time: number) => void;
  onReset: () => void;
}

const MIN_CLIP_DURATION = 5;

export function TrimControls({
  originalStart,
  originalEnd,
  trimStart,
  trimEnd,
  duration,
  currentTime,
  onTrimStartChange,
  onTrimEndChange,
  onSeek,
  onReset,
}: TrimControlsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    target: "start" | "end" | null;
  }>({ isDragging: false, target: null });

  const isModified = trimStart !== originalStart || trimEnd !== originalEnd;

  const timeToPercent = (time: number) => (time / duration) * 100;

  const handleMouseDown = (target: "start" | "end") => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragState({ isDragging: true, target });
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragState.isDragging || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const percent = (x / rect.width) * 100;
      const time = (percent / 100) * duration;

      if (dragState.target === "start") {
        const constrainedTime = Math.max(0, Math.min(time, trimEnd - MIN_CLIP_DURATION));
        onTrimStartChange(constrainedTime);
      } else {
        const constrainedTime = Math.min(duration, Math.max(time, trimStart + MIN_CLIP_DURATION));
        onTrimEndChange(constrainedTime);
      }
    },
    [dragState, duration, trimStart, trimEnd, onTrimStartChange, onTrimEndChange]
  );

  const handleMouseUp = useCallback(() => {
    setDragState({ isDragging: false, target: null });
  }, []);

  useEffect(() => {
    if (dragState.isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [dragState.isDragging, handleMouseMove, handleMouseUp]);

  const handleTrackClick = (e: React.MouseEvent) => {
    if (dragState.isDragging) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const percent = (x / rect.width) * 100;
    const time = (percent / 100) * duration;
    onSeek(time);
  };

  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-fg-secondary">Trim Clip</h3>
        {isModified && (
          <Button variant="ghost" size="sm" onClick={onReset}>
            Reset
          </Button>
        )}
      </div>

      <div
        ref={containerRef}
        className="relative h-10 bg-bg-overlay rounded cursor-pointer mb-3"
        onClick={handleTrackClick}
      >
        <div
          className="absolute top-0 bottom-0 bg-border-subtle rounded"
          style={{
            left: `${timeToPercent(originalStart)}%`,
            width: `${timeToPercent(originalEnd - originalStart)}%`,
          }}
        />

        <div
          className="absolute top-0 bottom-0 bg-accent/50"
          style={{
            left: `${timeToPercent(trimStart)}%`,
            width: `${timeToPercent(trimEnd - trimStart)}%`,
          }}
        />

        <div
          className="absolute top-0 bottom-0 w-0.5 bg-fg-default z-10"
          style={{ left: `${timeToPercent(currentTime)}%` }}
        />

        <div
          className="absolute top-0 bottom-0 w-3 bg-success rounded-l cursor-ew-resize hover:brightness-110 transition-all z-20 flex items-center justify-center"
          style={{ left: `${timeToPercent(trimStart)}%`, transform: "translateX(-100%)" }}
          onMouseDown={handleMouseDown("start")}
        >
          <div className="w-0.5 h-4 bg-success/50 rounded" />
        </div>

        <div
          className="absolute top-0 bottom-0 w-3 bg-error rounded-r cursor-ew-resize hover:brightness-110 transition-all z-20 flex items-center justify-center"
          style={{ left: `${timeToPercent(trimEnd)}%` }}
          onMouseDown={handleMouseDown("end")}
        >
          <div className="w-0.5 h-4 bg-error/50 rounded" />
        </div>
      </div>

      <div className="flex justify-between text-xs text-fg-muted">
        <div>
          <span className="text-success">Start:</span>{" "}
          <span className="font-mono">{formatTime(trimStart)}</span>
        </div>
        <div className="text-fg-faint">
          Duration: {formatTime(trimEnd - trimStart)}
        </div>
        <div>
          <span className="text-error">End:</span>{" "}
          <span className="font-mono">{formatTime(trimEnd)}</span>
        </div>
      </div>
    </div>
  );
}
