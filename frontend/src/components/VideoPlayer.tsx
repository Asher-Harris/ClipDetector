"use client";

import React, { useRef, useCallback, useState, useEffect } from "react";
import { getVideoUrl } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { Spinner } from "./ui";

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
  zoom?: number;
  viewportCenter?: number;
  onZoomChange?: (zoom: number) => void;
  onViewportCenterChange?: (center: number) => void;
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
  zoom: controlledZoom,
  viewportCenter: controlledViewportCenter,
  onZoomChange,
  onViewportCenterChange,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [internalTime, setInternalTime] = useState(0);
  const lastSeekTime = useRef<number | null>(null);
  const prevExternalTimeRef = useRef<number>(currentTime);
  const prevTimeRef = useRef(currentTime);

  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    target: "start" | "end" | "playhead" | null;
  }>({ isDragging: false, target: null });

  const currentDragPositionRef = useRef<number>(0);
  const dragEndedAtRef = useRef<number>(0);
  const [snapEnabled, setSnapEnabled] = useState(true);

  const [internalZoom, setInternalZoom] = useState(1);
  const [internalViewportCenter, setInternalViewportCenter] = useState(50);

  const zoom = controlledZoom ?? internalZoom;
  const viewportCenter = controlledViewportCenter ?? internalViewportCenter;

  const setZoom = useCallback((value: number | ((prev: number) => number)) => {
    const newValue = typeof value === 'function' ? value(zoom) : value;
    if (onZoomChange) {
      onZoomChange(newValue);
    } else {
      setInternalZoom(newValue);
    }
  }, [zoom, onZoomChange]);

  const setViewportCenter = useCallback((value: number | ((prev: number) => number)) => {
    const newValue = typeof value === 'function' ? value(viewportCenter) : value;
    if (onViewportCenterChange) {
      onViewportCenterChange(newValue);
    } else {
      setInternalViewportCenter(newValue);
    }
  }, [viewportCenter, onViewportCenterChange]);

  const videoUrl = getVideoUrl(vodPath);

  const visiblePercent = 100 / zoom;
  const halfVisible = visiblePercent / 2;
  const clampedCenter = Math.max(halfVisible, Math.min(100 - halfVisible, viewportCenter));
  const viewportStart = clampedCenter - halfVisible;

  const timeToGlobalPercent = (time: number) => (duration > 0 ? (time / duration) * 100 : 0);

  const timeToViewportPercent = (time: number) => {
    const globalPercent = timeToGlobalPercent(time);
    return ((globalPercent - viewportStart) / visiblePercent) * 100;
  };

  const viewportPercentToTime = useCallback((viewportPercent: number) => {
    const globalPercent = viewportStart + (viewportPercent / 100) * visiblePercent;
    return (globalPercent / 100) * duration;
  }, [duration, viewportStart, visiblePercent]);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      setDuration(video.duration);
      onDurationChange(video.duration);
      setIsLoading(false);
    }
  }, [onDurationChange]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video && lastSeekTime.current === null) {
      const nextTime = video.currentTime;
      const crossedTrimEnd = prevTimeRef.current < trimEnd && nextTime >= trimEnd;
      if (isPlaying && crossedTrimEnd) {
        video.pause();
        setIsPlaying(false);
      }
      prevTimeRef.current = nextTime;
      setInternalTime(nextTime);
      onTimeUpdate(nextTime);
      if (zoom > 1 && duration > 0) {
        setViewportCenter((nextTime / duration) * 100);
      }
    }
  }, [duration, isPlaying, onTimeUpdate, setViewportCenter, trimEnd, zoom]);

  const handleCanPlay = useCallback(() => setIsLoading(false), []);
  const handleWaiting = useCallback(() => setIsLoading(true), []);
  const handlePlaying = useCallback(() => setIsLoading(false), []);
  const handleSeeked = useCallback(() => {
    const video = videoRef.current;
    lastSeekTime.current = null;
    setIsLoading(false);
    if (video) {
      const nextTime = video.currentTime;
      prevTimeRef.current = nextTime;
      setInternalTime(nextTime);
      if (zoom > 1 && duration > 0) {
        setViewportCenter((nextTime / duration) * 100);
      }
    }
  }, [duration, setViewportCenter, zoom]);

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (video && duration > 0) {
      const clampedTime = Math.max(0, Math.min(duration, time));
      lastSeekTime.current = clampedTime;
      video.currentTime = clampedTime;
      setInternalTime(clampedTime);
      onSeek(clampedTime);
      if (zoom > 1) {
        setViewportCenter((clampedTime / duration) * 100);
      }
    }
  }, [duration, onSeek, setViewportCenter, zoom]);

  const pendingSeekRef = useRef<number | null>(currentTime);

  useEffect(() => {
    if (currentTime !== prevExternalTimeRef.current) {
      prevExternalTimeRef.current = currentTime;
      if (duration > 0) {
        if (Math.abs(internalTime - currentTime) > 1) {
          const video = videoRef.current;
          if (video) {
            const clampedTime = Math.max(0, Math.min(duration, currentTime));
            lastSeekTime.current = clampedTime;
            video.currentTime = clampedTime;
          }
        }
      } else {
        pendingSeekRef.current = currentTime;
      }
    }
  }, [currentTime, duration, internalTime]);

  useEffect(() => {
    if (duration > 0 && pendingSeekRef.current !== null) {
      const video = videoRef.current;
      if (video) {
        const clampedTime = Math.max(
          0,
          Math.min(duration, pendingSeekRef.current)
        );
        lastSeekTime.current = clampedTime;
        video.currentTime = clampedTime;
      }
      pendingSeekRef.current = null;
    }
  }, [duration]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragState.isDragging || !progressRef.current || duration === 0) return;

    const rect = progressRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const viewportPercent = (x / rect.width) * 100;
    const time = viewportPercentToTime(viewportPercent);

    if (dragState.target === "start") {
      const constrainedTime = Math.max(0, Math.min(time, trimEnd - MIN_CLIP_DURATION));
      currentDragPositionRef.current = constrainedTime;
      onTrimStartChange(constrainedTime);
    } else if (dragState.target === "end") {
      const constrainedTime = Math.min(duration, Math.max(time, trimStart + MIN_CLIP_DURATION));
      currentDragPositionRef.current = constrainedTime;
      onTrimEndChange(constrainedTime);
    } else if (dragState.target === "playhead") {
      seekTo(time);
      onTimeUpdate(time);
    }
  }, [dragState, duration, trimStart, trimEnd, onTrimStartChange, onTrimEndChange, seekTo, onTimeUpdate, viewportPercentToTime]);

  const SNAP_THRESHOLD_PERCENT = 2;

  const handleMouseUp = useCallback(() => {
    if (snapEnabled && dragState.target && dragState.target !== "playhead" && duration > 0) {
      const currentDragPosition = currentDragPositionRef.current;

      const visibleDuration = (visiblePercent / 100) * duration;
      const snapThresholdSeconds = (SNAP_THRESHOLD_PERCENT / 100) * visibleDuration;

      const distanceToPlayhead = Math.abs(currentDragPosition - internalTime);

      if (distanceToPlayhead <= snapThresholdSeconds) {
        if (dragState.target === "start" && internalTime < trimEnd - MIN_CLIP_DURATION) {
          onTrimStartChange(internalTime);
        } else if (dragState.target === "end" && internalTime > trimStart + MIN_CLIP_DURATION) {
          onTrimEndChange(internalTime);
        }
      }
    }
    dragEndedAtRef.current = Date.now();
    setDragState({ isDragging: false, target: null });
  }, [snapEnabled, dragState.target, trimStart, trimEnd, internalTime, duration, visiblePercent, onTrimStartChange, onTrimEndChange]);

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

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (dragState.isDragging) return;
    if (Date.now() - dragEndedAtRef.current < 100) return;

    const rect = progressRef.current?.getBoundingClientRect();
    if (!rect || duration === 0) return;

    const x = e.clientX - rect.left;
    const viewportPercent = (x / rect.width) * 100;
    const time = viewportPercentToTime(viewportPercent);
    seekTo(time);
    onTimeUpdate(time);
  }, [dragState.isDragging, duration, seekTo, onTimeUpdate, viewportPercentToTime]);

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
        // Playback error
      }
    }
  }, [isPlaying, internalTime]);

  const skip = useCallback((seconds: number) => {
    const newTime = Math.max(0, Math.min(duration, internalTime + seconds));
    seekTo(newTime);
    onTimeUpdate(newTime);
  }, [duration, internalTime, seekTo, onTimeUpdate]);

  const jumpToStart = useCallback(() => {
    seekTo(trimStart);
    onTimeUpdate(trimStart);
  }, [trimStart, seekTo, onTimeUpdate]);

  const jumpToEnd = useCallback(() => {
    seekTo(Math.max(trimStart, trimEnd - 1));
    onTimeUpdate(Math.max(trimStart, trimEnd - 1));
  }, [trimStart, trimEnd, seekTo, onTimeUpdate]);

  const MAX_ZOOM = 32;

  const zoomIn = useCallback(() => {
    setZoom(z => Math.min(MAX_ZOOM, z * 2));
  }, [setZoom]);

  const zoomOut = useCallback(() => {
    setZoom(z => Math.max(1, z / 2));
  }, [setZoom]);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setViewportCenter(50);
  }, [setZoom, setViewportCenter]);

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
    <div className="bg-bg-surface border border-border-default rounded-lg overflow-hidden">
      <div className="relative aspect-video bg-bg-base">
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
          <div className="absolute inset-0 flex items-center justify-center bg-bg-base/50">
            <Spinner size="lg" />
          </div>
        )}
      </div>

      <div className="p-4 space-y-3">
        <div
          ref={progressRef}
          className="relative h-12 cursor-pointer select-none overflow-hidden rounded-md bg-bg-overlay"
          onClick={handleProgressClick}
        >
          <div
            className="absolute top-0 bottom-0 bg-accent/15"
            style={{
              left: `${trimStartPercent}%`,
              width: `${Math.min(100, trimEndPercent) - trimStartPercent}%`,
            }}
          />

          {internalTime >= trimStart && internalTime <= trimEnd && (
            <div
              className="absolute top-0 bottom-0 bg-accent/25"
              style={{
                left: `${trimStartPercent}%`,
                width: `${Math.max(0, playheadPercent - trimStartPercent)}%`,
              }}
            />
          )}

          <div
            className="absolute top-0 bottom-0 z-20 cursor-ew-resize group"
            style={{ left: `${trimStartPercent}%` }}
            onMouseDown={startDrag("start")}
          >
            <div className="relative -translate-x-1/2 h-full flex items-center">
              <div className="w-1 h-full bg-success/80 group-hover:bg-success transition-colors" />
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-bg-surface border border-border-default text-fg-default text-[10px] font-mono px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-lg">
                {formatTime(trimStart)}
              </div>
            </div>
          </div>

          <div
            className="absolute top-0 bottom-0 z-20 cursor-ew-resize group"
            style={{ left: `${trimEndPercent}%` }}
            onMouseDown={startDrag("end")}
          >
            <div className="relative -translate-x-1/2 h-full flex items-center">
              <div className="w-1 h-full bg-error/80 group-hover:bg-error transition-colors" />
              <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-bg-surface border border-border-default text-fg-default text-[10px] font-mono px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-lg">
                {formatTime(trimEnd)}
              </div>
            </div>
          </div>

          <div
            className="absolute top-0 bottom-0 z-30 cursor-grab active:cursor-grabbing"
            style={{ left: `${playheadPercent}%` }}
            onMouseDown={startDrag("playhead")}
          >
            <div className="relative -translate-x-1/2 h-full">
              <div className="w-0.5 h-full bg-fg-default" />
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-fg-default rounded-full" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <button
              onClick={jumpToStart}
              className="p-1.5 rounded hover:bg-bg-hover text-fg-muted hover:text-fg-default transition-colors"
              title="Jump to in point ["
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6zM9.5 12l8.5 6V6z"/>
              </svg>
            </button>
            <button
              onClick={() => skip(-5)}
              className="px-2 py-1 rounded text-xs font-medium text-fg-muted hover:text-fg-default hover:bg-bg-hover transition-colors"
              title="Back 5s ←"
            >
              -5s
            </button>
            <button
              onClick={togglePlay}
              className="w-8 h-8 rounded-full bg-accent hover:bg-accent-hover text-accent-fg flex items-center justify-center transition-colors"
              title="Play/Pause (Space)"
            >
              {isPlaying ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1"/>
                  <rect x="14" y="4" width="4" height="16" rx="1"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              )}
            </button>
            <button
              onClick={() => skip(5)}
              className="px-2 py-1 rounded text-xs font-medium text-fg-muted hover:text-fg-default hover:bg-bg-hover transition-colors"
              title="Forward 5s →"
            >
              +5s
            </button>
            <button
              onClick={jumpToEnd}
              className="p-1.5 rounded hover:bg-bg-hover text-fg-muted hover:text-fg-default transition-colors"
              title="Jump to out point ]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z"/>
              </svg>
            </button>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2 text-fg-muted font-mono tabular-nums">
              <span className="text-fg-default">{formatTime(internalTime)}</span>
              <span>/</span>
              <span>{formatTime(duration)}</span>
            </div>

            <div className="h-4 w-px bg-border-default" />

            <div className="flex items-center gap-2 font-mono tabular-nums">
              <span className="text-success">{formatTime(trimStart)}</span>
              <span className="text-fg-faint">→</span>
              <span className="text-error">{formatTime(trimEnd)}</span>
              <span className="text-fg-muted">({formatTime(clipDuration)})</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setSnapEnabled(!snapEnabled)}
              className={`p-1.5 rounded transition-colors ${
                snapEnabled
                  ? "text-accent bg-accent-muted"
                  : "text-fg-faint hover:text-fg-muted hover:bg-bg-hover"
              }`}
              title={`Snap: ${snapEnabled ? "ON" : "OFF"}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 4v10a7 7 0 0 0 14 0V4" stroke="currentColor" fill="none" />
                <rect x="3" y="2" width="4" height="6" rx="1" fill="currentColor" stroke="none" />
                <rect x="17" y="2" width="4" height="6" rx="1" fill="currentColor" stroke="none" />
              </svg>
            </button>

            <div className="flex items-center">
              <button
                onClick={zoomOut}
                disabled={zoom <= 1}
                className="p-1.5 rounded hover:bg-bg-hover text-fg-muted hover:text-fg-default disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Zoom out (-)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="M21 21l-4.35-4.35M8 11h6"/>
                </svg>
              </button>
              <span className="text-[11px] text-fg-muted font-mono w-8 text-center tabular-nums">
                {zoom}×
              </span>
              <button
                onClick={zoomIn}
                disabled={zoom >= MAX_ZOOM}
                className="p-1.5 rounded hover:bg-bg-hover text-fg-muted hover:text-fg-default disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Zoom in (+)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="M21 21l-4.35-4.35M11 8v6M8 11h6"/>
                </svg>
              </button>
              {zoom > 1 && (
                <button
                  onClick={resetZoom}
                  className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-fg-muted hover:text-fg-default hover:bg-bg-hover transition-colors"
                  title="Reset zoom (0)"
                >
                  1:1
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function VideoPlayer(props: VideoPlayerProps) {
  return <VideoPlayerInner {...props} />;
}
