"use client";

import { useRef } from "react";
import { formatTime } from "@/lib/format";

interface TimelineMarker {
  id: string;
  time: number;
  score: number;
}

interface TimelineProps {
  duration: number;
  currentTime: number;
  markers: TimelineMarker[];
  selectedMarkerId: string | null;
  trimStart?: number;
  trimEnd?: number;
  onSeek: (time: number) => void;
  onMarkerClick: (id: string) => void;
}

export function Timeline({
  duration,
  currentTime,
  markers,
  selectedMarkerId,
  trimStart,
  trimEnd,
  onSeek,
  onMarkerClick,
}: TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  if (duration === 0) return null;

  const timeToPercent = (time: number) => Math.min(100, Math.max(0, (time / duration) * 100));

  const handleClick = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const percent = x / rect.width;
    const time = percent * duration;
    onSeek(Math.max(0, Math.min(time, duration)));
  };

  // Calculate max score for scaling
  const maxScore = Math.max(...markers.map((m) => m.score), 1);

  // Generate time labels
  const labelCount = 5;
  const timeLabels = Array.from({ length: labelCount }, (_, i) => {
    const time = (duration / (labelCount - 1)) * i;
    return { time, label: formatTime(time) };
  });

  return (
    <div className="bg-zinc-900 rounded-lg p-4">
      <h3 className="text-sm font-medium text-zinc-300 mb-3">VOD Timeline</h3>

      {/* Timeline Track */}
      <div
        ref={containerRef}
        className="relative h-8 bg-zinc-800 rounded cursor-pointer mb-2"
        onClick={handleClick}
      >
        {/* Selected clip region */}
        {trimStart !== undefined && trimEnd !== undefined && (
          <div
            className="absolute top-0 bottom-0 bg-blue-600/30"
            style={{
              left: `${timeToPercent(trimStart)}%`,
              width: `${timeToPercent(Math.min(trimEnd, duration)) - timeToPercent(trimStart)}%`,
            }}
          />
        )}

        {/* Markers */}
        {markers.map((marker) => {
          const isSelected = marker.id === selectedMarkerId;
          const intensity = marker.score / maxScore;
          const size = 8 + intensity * 8; // 8-16px

          return (
            <button
              key={marker.id}
              className={`absolute top-1/2 -translate-y-1/2 rounded-full transition-all ${
                isSelected
                  ? "bg-blue-500 ring-2 ring-blue-300"
                  : "bg-zinc-400 hover:bg-zinc-300"
              }`}
              style={{
                left: `${timeToPercent(marker.time)}%`,
                width: size,
                height: size,
                transform: `translate(-50%, -50%)`,
                opacity: 0.5 + intensity * 0.5,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onMarkerClick(marker.id);
              }}
              title={`Score: ${marker.score.toFixed(2)} at ${formatTime(marker.time)}`}
            />
          );
        })}

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white z-10 pointer-events-none"
          style={{ left: `${timeToPercent(currentTime)}%` }}
        >
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-white" />
        </div>
      </div>

      {/* Time Labels */}
      <div className="flex justify-between text-xs text-zinc-500">
        {timeLabels.map(({ time, label }) => (
          <span key={time} className="font-mono">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
