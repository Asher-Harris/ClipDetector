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
  zoom?: number;
  viewportCenter?: number;
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
  zoom = 1,
  viewportCenter = 50,
}: TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  if (duration === 0) return null;

  const visiblePercent = 100 / zoom;
  const halfVisible = visiblePercent / 2;
  const clampedCenter = Math.max(halfVisible, Math.min(100 - halfVisible, viewportCenter));
  const viewportStart = clampedCenter - halfVisible;
  const viewportEnd = clampedCenter + halfVisible;

  const timeToGlobalPercent = (time: number) => (duration > 0 ? (time / duration) * 100 : 0);

  const timeToPercent = (time: number) => {
    const globalPercent = timeToGlobalPercent(time);
    return ((globalPercent - viewportStart) / visiblePercent) * 100;
  };

  const viewportPercentToTime = (viewportPercent: number) => {
    const globalPercent = viewportStart + (viewportPercent / 100) * visiblePercent;
    return (globalPercent / 100) * duration;
  };

  const handleClick = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const viewportPercent = (x / rect.width) * 100;
    const time = viewportPercentToTime(viewportPercent);
    onSeek(Math.max(0, Math.min(time, duration)));
  };

  const maxScore = Math.max(...markers.map((m) => m.score), 1);

  const labelCount = 5;
  const visibleStartTime = (viewportStart / 100) * duration;
  const visibleEndTime = (viewportEnd / 100) * duration;
  const visibleDuration = visibleEndTime - visibleStartTime;
  const timeLabels = Array.from({ length: labelCount }, (_, i) => {
    const time = visibleStartTime + (visibleDuration / (labelCount - 1)) * i;
    return { time, label: formatTime(time) };
  });

  return (
    <div className="bg-bg-surface border border-border-default rounded-lg p-4">
      <h3 className="text-sm font-medium text-fg-secondary mb-3">VOD Timeline</h3>

      <div
        ref={containerRef}
        className="relative h-8 bg-bg-overlay rounded cursor-pointer mb-2 overflow-hidden"
        onClick={handleClick}
      >
        {trimStart !== undefined && trimEnd !== undefined && (
          <div
            className="absolute top-0 bottom-0 bg-accent/30"
            style={{
              left: `${timeToPercent(trimStart)}%`,
              width: `${timeToPercent(Math.min(trimEnd, duration)) - timeToPercent(trimStart)}%`,
            }}
          />
        )}

        {markers.map((marker) => {
          const isSelected = marker.id === selectedMarkerId;
          const intensity = marker.score / maxScore;
          const size = 8 + intensity * 8;

          return (
            <button
              key={marker.id}
              className={`absolute top-1/2 -translate-y-1/2 rounded-full transition-all ${
                isSelected
                  ? "bg-accent ring-2 ring-accent/50"
                  : "bg-fg-muted hover:bg-fg-secondary"
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

        <div
          className="absolute top-0 bottom-0 w-0.5 bg-fg-default z-10 pointer-events-none"
          style={{ left: `${timeToPercent(currentTime)}%` }}
        >
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-fg-default" />
        </div>
      </div>

      <div className="flex justify-between text-xs text-fg-muted">
        {timeLabels.map(({ time, label }) => (
          <span key={time} className="font-mono">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
