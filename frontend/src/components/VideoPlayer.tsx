"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import { getVideoUrl } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { Button, Spinner } from "./ui";

interface VideoPlayerProps {
  vodPath: string;
  currentTime: number;
  trimStart: number;
  trimEnd: number;
  onTimeUpdate: (time: number) => void;
  onDurationChange: (duration: number) => void;
  onSeek: (time: number) => void;
  onTrimStartChange: (time: number) => void;
  onTrimEndChange: (time: number) => void;
}

const MIN_CLIP_DURATION = 5;

function VideoPlayerInner({
  vodPath,
  currentTime,
  trimStart,
  trimEnd,
  onTimeUpdate,
  onDurationChange,
  onSeek,
  onTrimStartChange,
  onTrimEndChange,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [internalTime, setInternalTime] = useState(0);
  const lastSeekTime = useRef<number | null>(null);
  const prevExternalTimeRef = useRef<number>(currentTime);

  // Drag state for trim handles
  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    target: "start" | "end" | "playhead" | null;
  }>({ isDragging: false, target: null });

  // Zoom state: 1 = full timeline, 2 = 50% visible, etc.
  const [zoom, setZoom] = useState(1);
  // Viewport center as percentage of total duration (0-100)
  const [viewportCenter, setViewportCenter] = useState(50);

  const videoUrl = getVideoUrl(vodPath);

  // Calculate viewport boundaries based on zoom
  const visiblePercent = 100 / zoom;
  const halfVisible = visiblePercent / 2;
  // Clamp viewport so it doesn't go past edges
  const clampedCenter = Math.max(halfVisible, Math.min(100 - halfVisible, viewportCenter));
  const viewportStart = clampedCenter - halfVisible;
  const viewportEnd = clampedCenter + halfVisible;

  // Convert time to global percentage (0-100 of full duration)
  const timeToGlobalPercent = (time: number) => (duration > 0 ? (time / duration) * 100 : 0);

  // Keep viewport centered on playhead when zoomed
  useEffect(() => {
    if (zoom > 1 && duration > 0) {
      const playheadPercent = (internalTime / duration) * 100;
      setViewportCenter(playheadPercent);
    }
  }, [zoom, internalTime, duration]);

  // Convert time to viewport percentage (position within visible area)
  const timeToViewportPercent = (time: number) => {
    const globalPercent = timeToGlobalPercent(time);
    return ((globalPercent - viewportStart) / visiblePercent) * 100;
  };

  // Convert viewport percentage to time
  const viewportPercentToTime = (viewportPercent: number) => {
    const globalPercent = viewportStart + (viewportPercent / 100) * visiblePercent;
    return (globalPercent / 100) * duration;
  };

  // Handle metadata loaded
  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      setDuration(video.duration);
      onDurationChange(video.duration);
      setIsLoading(false);
    }
  }, [onDurationChange]);

  // Handle time updates
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video && lastSeekTime.current === null) {
      setInternalTime(video.currentTime);
      onTimeUpdate(video.currentTime);
    }
  }, [onTimeUpdate]);

  const handleCanPlay = useCallback(() => setIsLoading(false), []);
  const handleWaiting = useCallback(() => setIsLoading(true), []);
  const handlePlaying = useCallback(() => setIsLoading(false), []);
  const handleSeeked = useCallback(() => {
    lastSeekTime.current = null;
    setIsLoading(false);
  }, []);

  // Seek to time
  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (video && duration > 0) {
      const clampedTime = Math.max(0, Math.min(duration, time));
      lastSeekTime.current = clampedTime;
      video.currentTime = clampedTime;
      setInternalTime(clampedTime);
      onSeek(clampedTime);
    }
  }, [duration, onSeek]);

  // Pending seek for when video isn't loaded yet - initialize with currentTime
  // so we seek to the right position when the video first loads
  const pendingSeekRef = useRef<number | null>(currentTime);

  // Handle external seek requests (when clip is selected)
  useEffect(() => {
    if (currentTime !== prevExternalTimeRef.current) {
      prevExternalTimeRef.current = currentTime;
      if (duration > 0) {
        seekTo(currentTime);
      } else {
        // Video not loaded yet, store pending seek
        pendingSeekRef.current = currentTime;
      }
    }
  }, [currentTime, duration, seekTo]);

  // Apply pending seek once video loads
  useEffect(() => {
    if (duration > 0 && pendingSeekRef.current !== null) {
      seekTo(pendingSeekRef.current);
      pendingSeekRef.current = null;
    }
  }, [duration, seekTo]);

  // Mouse move handler for dragging
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragState.isDragging || !progressRef.current || duration === 0) return;

    const rect = progressRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const viewportPercent = (x / rect.width) * 100;
    const time = viewportPercentToTime(viewportPercent);

    if (dragState.target === "start") {
      const constrainedTime = Math.max(0, Math.min(time, trimEnd - MIN_CLIP_DURATION));
      onTrimStartChange(constrainedTime);
    } else if (dragState.target === "end") {
      const constrainedTime = Math.min(duration, Math.max(time, trimStart + MIN_CLIP_DURATION));
      onTrimEndChange(constrainedTime);
    } else if (dragState.target === "playhead") {
      seekTo(time);
      onTimeUpdate(time);
    }
  }, [dragState, duration, trimStart, trimEnd, onTrimStartChange, onTrimEndChange, seekTo, onTimeUpdate, viewportStart, visiblePercent]);

  // Mouse up handler
  const handleMouseUp = useCallback(() => {
    setDragState({ isDragging: false, target: null });
  }, []);

  // Add/remove window event listeners for dragging
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

  // Handle click on progress bar (seek)
  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (dragState.isDragging) return;
    const rect = progressRef.current?.getBoundingClientRect();
    if (!rect || duration === 0) return;

    const x = e.clientX - rect.left;
    const viewportPercent = (x / rect.width) * 100;
    const time = viewportPercentToTime(viewportPercent);
    seekTo(time);
    onTimeUpdate(time);
  }, [dragState.isDragging, duration, seekTo, onTimeUpdate, viewportStart, visiblePercent]);

  // Start dragging a handle
  const startDrag = (target: "start" | "end" | "playhead") => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragState({ isDragging: true, target });
  };

  const togglePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (isPlaying) {
        video.pause();
        setIsPlaying(false);
      } else {
        const videoOutOfSync = Math.abs(video.currentTime - internalTime) > 0.5;
        if (videoOutOfSync) {
          video.currentTime = internalTime;
          await new Promise<void>((resolve) => {
            const onSeeked = () => {
              video.removeEventListener('seeked', onSeeked);
              resolve();
            };
            video.addEventListener('seeked', onSeeked);
          });
        }

        await video.play();
        setIsPlaying(true);
      }
    } catch (err) {
      const isAbortError = err instanceof Error && err.name === "AbortError";
      if (!isAbortError) {
        console.error("Playback error:", err);
      }
    }
  }, [isPlaying, internalTime]);

  // Auto-pause when crossing trim end (not when already past it)
  const prevTimeRef = useRef(internalTime);
  useEffect(() => {
    const crossedTrimEnd = prevTimeRef.current < trimEnd && internalTime >= trimEnd;
    if (isPlaying && crossedTrimEnd) {
      videoRef.current?.pause();
      setIsPlaying(false);
    }
    prevTimeRef.current = internalTime;
  }, [isPlaying, internalTime, trimEnd]);

  const skip = useCallback((seconds: number) => {
    const newTime = Math.max(0, Math.min(duration, internalTime + seconds));
    seekTo(newTime);
    onTimeUpdate(newTime);
  }, [duration, internalTime, seekTo, onTimeUpdate]);

  // Jump to trim start/end
  const jumpToStart = useCallback(() => {
    seekTo(trimStart);
    onTimeUpdate(trimStart);
  }, [trimStart, seekTo, onTimeUpdate]);

  const jumpToEnd = useCallback(() => {
    seekTo(Math.max(trimStart, trimEnd - 1));
    onTimeUpdate(Math.max(trimStart, trimEnd - 1));
  }, [trimStart, trimEnd, seekTo, onTimeUpdate]);

  // Zoom controls
  const MAX_ZOOM = 32;

  const zoomIn = useCallback(() => {
    setZoom(z => Math.min(MAX_ZOOM, z * 2));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom(z => Math.max(1, z / 2));
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setViewportCenter(50);
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          skip(-5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          skip(5);
          break;
        case '[':
          e.preventDefault();
          jumpToStart();
          break;
        case ']':
          e.preventDefault();
          jumpToEnd();
          break;
        case '=':
        case '+':
          e.preventDefault();
          zoomIn();
          break;
        case '-':
          e.preventDefault();
          zoomOut();
          break;
        case '0':
          e.preventDefault();
          resetZoom();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, skip, jumpToStart, jumpToEnd, zoomIn, zoomOut, resetZoom]);

  const clipDuration = trimEnd - trimStart;
  const playheadPercent = timeToViewportPercent(internalTime);
  const trimStartPercent = timeToViewportPercent(trimStart);
  const trimEndPercent = timeToViewportPercent(trimEnd);

  return (
    <div className="bg-zinc-900 rounded-lg overflow-hidden">
      {/* Video */}
      <div className="relative aspect-video bg-black">
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full h-full"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onCanPlay={handleCanPlay}
          onWaiting={handleWaiting}
          onPlaying={handlePlaying}
          onSeeked={handleSeeked}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
          playsInline
        />

        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Spinner size="lg" />
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="p-4">
        {/* Progress Bar with Trim Handles */}
        <div
          ref={progressRef}
          className="relative h-8 mb-4 cursor-pointer select-none"
          onClick={handleProgressClick}
        >
          {/* Background track */}
          <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-2 bg-zinc-700 rounded-full" />

          {/* Trim region highlight */}
          <div
            className="absolute top-1/2 -translate-y-1/2 h-2 bg-blue-600/40 rounded-full"
            style={{
              left: `${trimStartPercent}%`,
              width: `${Math.min(100, trimEndPercent) - trimStartPercent}%`,
            }}
          />

          {/* Played portion within trim */}
          {internalTime >= trimStart && internalTime <= trimEnd && (
            <div
              className="absolute top-1/2 -translate-y-1/2 h-2 bg-blue-500 rounded-l-full"
              style={{
                left: `${trimStartPercent}%`,
                width: `${Math.max(0, playheadPercent - trimStartPercent)}%`,
              }}
            />
          )}

          {/* Trim Start Handle */}
          <div
            className="absolute top-1/2 -translate-y-1/2 z-20 cursor-ew-resize group"
            style={{ left: `${trimStartPercent}%` }}
            onMouseDown={startDrag("start")}
          >
            <div className="relative -translate-x-1/2">
              <div className="w-1 h-6 bg-green-500 rounded-full group-hover:bg-green-400 transition-colors" />
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-green-600 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                {formatTime(trimStart)}
              </div>
            </div>
          </div>

          {/* Trim End Handle */}
          <div
            className="absolute top-1/2 -translate-y-1/2 z-20 cursor-ew-resize group"
            style={{ left: `${trimEndPercent}%` }}
            onMouseDown={startDrag("end")}
          >
            <div className="relative -translate-x-1/2">
              <div className="w-1 h-6 bg-red-500 rounded-full group-hover:bg-red-400 transition-colors" />
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-red-600 text-white text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                {formatTime(trimEnd)}
              </div>
            </div>
          </div>

          {/* Playhead */}
          <div
            className="absolute top-1/2 -translate-y-1/2 z-30 cursor-grab active:cursor-grabbing"
            style={{ left: `${playheadPercent}%` }}
            onMouseDown={startDrag("playhead")}
          >
            <div className="relative -translate-x-1/2">
              <div className="w-3 h-3 bg-white rounded-full shadow-lg ring-2 ring-white/30" />
            </div>
          </div>
        </div>

        {/* Time display */}
        <div className="flex items-center justify-between mb-4 text-sm">
          <div className="flex items-center gap-4">
            <span className="text-zinc-400">
              <span className="text-white font-mono">{formatTime(internalTime)}</span>
              <span className="mx-1">/</span>
              <span className="font-mono">{formatTime(duration)}</span>
            </span>
          </div>
          <div className="flex items-center gap-2 text-zinc-400">
            <span className="text-green-400">In:</span>
            <span className="font-mono text-white">{formatTime(trimStart)}</span>
            <span className="text-red-400 ml-2">Out:</span>
            <span className="font-mono text-white">{formatTime(trimEnd)}</span>
            <span className="text-zinc-500 ml-2">({formatTime(clipDuration)} clip)</span>
          </div>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={jumpToStart} title="Jump to clip start [">
              ⏮
            </Button>
            <Button variant="ghost" size="sm" onClick={() => skip(-5)} title="Back 5s (←)">
              -5s
            </Button>
            <Button variant="primary" size="sm" onClick={togglePlay} title="Play/Pause (Space)">
              {isPlaying ? "Pause" : "Play"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => skip(5)} title="Forward 5s (→)">
              +5s
            </Button>
            <Button variant="ghost" size="sm" onClick={jumpToEnd} title="Jump to clip end ]">
              ⏭
            </Button>
          </div>

          {/* Zoom Controls */}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={zoomOut} disabled={zoom <= 1} title="Zoom out (-)">
              −
            </Button>
            <span className="text-xs text-zinc-400 font-mono w-10 text-center">
              {zoom}x
            </span>
            <Button variant="ghost" size="sm" onClick={zoomIn} disabled={zoom >= MAX_ZOOM} title="Zoom in (+)">
              +
            </Button>
            {zoom > 1 && (
              <Button variant="ghost" size="sm" onClick={resetZoom} title="Reset zoom (0)">
                1:1
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function VideoPlayer(props: VideoPlayerProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="bg-zinc-900 rounded-lg overflow-hidden">
        <div className="relative aspect-video flex items-center justify-center bg-black">
          <Spinner size="lg" />
        </div>
        <div className="p-4">
          <div className="h-8 bg-zinc-800 rounded mb-4" />
          <div className="h-4 bg-zinc-800 rounded w-1/3 mb-4" />
          <div className="flex gap-2">
            <div className="h-8 w-12 bg-zinc-800 rounded" />
            <div className="h-8 w-12 bg-zinc-800 rounded" />
            <div className="h-8 w-16 bg-zinc-800 rounded" />
            <div className="h-8 w-12 bg-zinc-800 rounded" />
            <div className="h-8 w-12 bg-zinc-800 rounded" />
          </div>
        </div>
      </div>
    );
  }

  return <VideoPlayerInner {...props} />;
}
