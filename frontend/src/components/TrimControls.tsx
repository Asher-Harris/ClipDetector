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
  const percentToTime = (percent: number) => (percent / 100) * duration;

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
      const time = percentToTime(percent);

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
    const time = percentToTime(percent);
    // Seek to clicked position
    onSeek(time);
  };

  return (
    <div className="bg-zinc-900 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-zinc-300">Trim Clip</h3>
        {isModified && (
          <Button variant="ghost" size="sm" onClick={onReset}>
            Reset
          </Button>
        )}
      </div>

      {/* Trim Slider */}
      <div
        ref={containerRef}
        className="relative h-10 bg-zinc-800 rounded cursor-pointer mb-3"
        onClick={handleTrackClick}
      >
        {/* Original clip range (dimmed) */}
        <div
          className="absolute top-0 bottom-0 bg-zinc-700/30 rounded"
          style={{
            left: `${timeToPercent(originalStart)}%`,
            width: `${timeToPercent(originalEnd - originalStart)}%`,
          }}
        />

        {/* Selected trim range */}
        <div
          className="absolute top-0 bottom-0 bg-blue-600/50"
          style={{
            left: `${timeToPercent(trimStart)}%`,
            width: `${timeToPercent(trimEnd - trimStart)}%`,
          }}
        />

        {/* Current playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white z-10"
          style={{ left: `${timeToPercent(currentTime)}%` }}
        />

        {/* Start Handle */}
        <div
          className="absolute top-0 bottom-0 w-3 bg-green-500 rounded-l cursor-ew-resize hover:bg-green-400 transition-colors z-20 flex items-center justify-center"
          style={{ left: `${timeToPercent(trimStart)}%`, transform: "translateX(-100%)" }}
          onMouseDown={handleMouseDown("start")}
        >
          <div className="w-0.5 h-4 bg-green-900 rounded" />
        </div>

        {/* End Handle */}
        <div
          className="absolute top-0 bottom-0 w-3 bg-red-500 rounded-r cursor-ew-resize hover:bg-red-400 transition-colors z-20 flex items-center justify-center"
          style={{ left: `${timeToPercent(trimEnd)}%` }}
          onMouseDown={handleMouseDown("end")}
        >
          <div className="w-0.5 h-4 bg-red-900 rounded" />
        </div>
      </div>

      {/* Time Labels */}
      <div className="flex justify-between text-xs text-zinc-400">
        <div>
          <span className="text-green-400">Start:</span>{" "}
          <span className="font-mono">{formatTime(trimStart)}</span>
        </div>
        <div className="text-zinc-500">
          Duration: {formatTime(trimEnd - trimStart)}
        </div>
        <div>
          <span className="text-red-400">End:</span>{" "}
          <span className="font-mono">{formatTime(trimEnd)}</span>
        </div>
      </div>
    </div>
  );
}
