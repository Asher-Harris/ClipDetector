"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import { getVideoUrl } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { Button, Spinner } from "./ui";

interface ClipVideoPlayerProps {
  vodPath: string;
  clipStart: number;
  clipEnd: number;
  trimStart: number;
  trimEnd: number;
  onTrimStartChange: (time: number) => void;
  onTrimEndChange: (time: number) => void;
}

const MIN_CLIP_DURATION = 5;

function ClipVideoPlayerInner({
  vodPath,
  clipStart,
  clipEnd,
  trimStart,
  trimEnd,
  onTrimStartChange,
  onTrimEndChange,
}: ClipVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [internalTime, setInternalTime] = useState(0);
  const lastSeekTime = useRef<number | null>(null);

  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    target: "start" | "end" | "playhead" | null;
  }>({ isDragging: false, target: null });

  const videoUrl = getVideoUrl(vodPath);
  const [actualClipEnd, setActualClipEnd] = useState(clipEnd);
  const clipDuration = actualClipEnd - clipStart;

  // Track previous clipStart to detect clip changes
  const prevClipStartRef = useRef(clipStart);

  // Reset and clamp actualClipEnd when clip changes, and seek to new position
  useEffect(() => {
    const video = videoRef.current;
    const clipChanged = prevClipStartRef.current !== clipStart;
    prevClipStartRef.current = clipStart;

    if (video && video.duration) {
      const clampedClipEnd = Math.min(clipEnd, video.duration);
      setActualClipEnd(clampedClipEnd);

      const actualDuration = clampedClipEnd - clipStart;
      console.log('[ClipVideoPlayer] clip bounds changed', {
        clipChanged,
        clipStart,
        clipEnd,
        videoDuration: video.duration,
        clampedClipEnd,
        actualDuration,
        trimStart,
      });

      // Update trim bounds if they exceed actual video
      if (trimEnd > actualDuration) {
        onTrimEndChange(actualDuration);
      }

      // Seek to new clip position when clip changes
      if (clipChanged) {
        const clampedTrimStart = Math.min(trimStart, actualDuration);
        const absoluteStart = clipStart + clampedTrimStart;
        video.currentTime = absoluteStart;
        setInternalTime(clampedTrimStart);
        setIsPlaying(false);
      }
    } else {
      setActualClipEnd(clipEnd);
    }
  }, [clipStart, clipEnd, trimStart, trimEnd, onTrimEndChange]);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      // Clamp clipEnd to actual video duration
      const clampedClipEnd = Math.min(clipEnd, video.duration);
      setActualClipEnd(clampedClipEnd);

      const actualDuration = clampedClipEnd - clipStart;
      const clampedTrimStart = Math.min(trimStart, actualDuration);
      const clampedTrimEnd = Math.min(trimEnd, actualDuration);

      const absoluteStart = clipStart + clampedTrimStart;

      console.log('[ClipVideoPlayer] handleLoadedMetadata', {
        videoDuration: video.duration,
        clipStart,
        clipEnd,
        clampedClipEnd,
        actualDuration,
        trimStart,
        trimEnd,
        clampedTrimStart,
        clampedTrimEnd,
        absoluteStart,
      });

      // Update trim bounds if they exceed actual video
      if (trimEnd > actualDuration) {
        onTrimEndChange(actualDuration);
      }
      if (trimStart > actualDuration) {
        onTrimStartChange(0);
      }

      video.currentTime = absoluteStart;
      setInternalTime(clampedTrimStart);
      setIsLoading(false);
    }
  }, [clipStart, clipEnd, trimStart, trimEnd, onTrimStartChange, onTrimEndChange]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (video && lastSeekTime.current === null) {
      const relativeTime = video.currentTime - clipStart;
      const clamped = Math.max(0, Math.min(clipDuration, relativeTime));
      const snapped = clipDuration - clamped < 0.05 ? clipDuration : clamped;
      console.log('[ClipVideoPlayer] handleTimeUpdate', {
        videoCurrentTime: video.currentTime,
        clipStart,
        clipDuration,
        relativeTime,
        clamped,
        snapped,
      });
      setInternalTime(snapped);
    }
  }, [clipStart, clipDuration]);

  const handleCanPlay = useCallback(() => setIsLoading(false), []);
  const handleWaiting = useCallback(() => setIsLoading(true), []);
  const handlePlaying = useCallback(() => setIsLoading(false), []);
  const handleSeeked = useCallback(() => {
    lastSeekTime.current = null;
    setIsLoading(false);
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const seekTo = useCallback((relativeTime: number) => {
    const video = videoRef.current;
    if (video && clipDuration > 0) {
      const clamped = Math.max(0, Math.min(clipDuration, relativeTime));
      let absoluteTime = clipStart + clamped;
      const originalAbsolute = absoluteTime;

      if (video.duration && absoluteTime >= video.duration - 0.05) {
        absoluteTime = video.duration - 0.05;
      }

      console.log('[ClipVideoPlayer] seekTo', {
        requestedRelativeTime: relativeTime,
        clamped,
        originalAbsolute,
        absoluteTime,
        videoDuration: video.duration,
        clipStart,
        clipDuration,
      });

      lastSeekTime.current = absoluteTime;
      video.currentTime = absoluteTime;
      setInternalTime(clamped);
    }
  }, [clipStart, clipDuration]);

  const prevTimeRef = useRef(internalTime);
  useEffect(() => {
    const crossedTrimEnd = prevTimeRef.current < trimEnd && internalTime >= trimEnd;
    if (isPlaying && crossedTrimEnd) {
      videoRef.current?.pause();
      setIsPlaying(false);
    }
    prevTimeRef.current = internalTime;
  }, [isPlaying, internalTime, trimEnd]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragState.isDragging || !progressRef.current || clipDuration === 0) return;

    const rect = progressRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percent = (x / rect.width) * 100;
    const relativeTime = (percent / 100) * clipDuration;

    console.log('[ClipVideoPlayer] handleMouseMove', {
      target: dragState.target,
      mouseX: e.clientX,
      rectLeft: rect.left,
      rectWidth: rect.width,
      x,
      percent,
      relativeTime,
      clipDuration,
    });

    if (dragState.target === "start") {
      const constrained = Math.max(0, Math.min(relativeTime, trimEnd - MIN_CLIP_DURATION));
      onTrimStartChange(constrained);
    } else if (dragState.target === "end") {
      const constrained = Math.min(clipDuration, Math.max(relativeTime, trimStart + MIN_CLIP_DURATION));
      onTrimEndChange(constrained);
    } else if (dragState.target === "playhead") {
      seekTo(relativeTime);
    }
  }, [dragState, clipDuration, trimStart, trimEnd, onTrimStartChange, onTrimEndChange, seekTo]);

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

  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (dragState.isDragging) return;
    const rect = progressRef.current?.getBoundingClientRect();
    if (!rect || clipDuration === 0) return;

    const x = e.clientX - rect.left;
    const percent = (x / rect.width) * 100;
    const relativeTime = (percent / 100) * clipDuration;

    console.log('[ClipVideoPlayer] handleProgressClick', {
      mouseX: e.clientX,
      rectLeft: rect.left,
      rectWidth: rect.width,
      x,
      percent,
      relativeTime,
      clipDuration,
    });

    seekTo(relativeTime);
  }, [dragState.isDragging, clipDuration, seekTo]);

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
        const absoluteTarget = clipStart + internalTime;
        const videoOutOfSync = Math.abs(video.currentTime - absoluteTarget) > 0.5;
        if (videoOutOfSync) {
          video.currentTime = absoluteTarget;
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
        // Playback error - silently ignore
      }
    }
  }, [isPlaying, internalTime, clipStart]);

  const skip = useCallback((seconds: number) => {
    const newTime = Math.max(0, Math.min(clipDuration, internalTime + seconds));
    seekTo(newTime);
  }, [clipDuration, internalTime, seekTo]);

  const jumpToTrimStart = useCallback(() => {
    seekTo(trimStart);
  }, [trimStart, seekTo]);

  const jumpToTrimEnd = useCallback(() => {
    const targetTime = Math.max(trimStart, trimEnd - 0.1);
    seekTo(targetTime);
  }, [trimStart, trimEnd, seekTo]);

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
          jumpToTrimStart();
          break;
        case ']':
          e.preventDefault();
          jumpToTrimEnd();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, skip, jumpToTrimStart, jumpToTrimEnd]);

  const trimmedDuration = trimEnd - trimStart;
  const playheadPercent = clipDuration > 0 ? (internalTime / clipDuration) * 100 : 0;
  const trimStartPercent = clipDuration > 0 ? (trimStart / clipDuration) * 100 : 0;
  const trimEndPercent = clipDuration > 0 ? (trimEnd / clipDuration) * 100 : 100;

  console.log('[ClipVideoPlayer] render', {
    internalTime,
    clipDuration,
    playheadPercent,
    trimStart,
    trimEnd,
    trimStartPercent,
    trimEndPercent,
  });

  return (
    <div className="bg-zinc-900 rounded-lg overflow-hidden">
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
          onEnded={handleEnded}
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

      <div className="p-4">
        <div
          ref={progressRef}
          className="relative h-8 mb-4 cursor-pointer select-none"
          onClick={handleProgressClick}
        >
          <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-2 bg-zinc-700 rounded-full" />

          <div
            className="absolute top-1/2 -translate-y-1/2 h-2 bg-blue-600/40 rounded-full"
            style={{
              left: `${trimStartPercent}%`,
              width: `${trimEndPercent - trimStartPercent}%`,
            }}
          />

          {internalTime >= trimStart && internalTime <= trimEnd && (
            <div
              className="absolute top-1/2 -translate-y-1/2 h-2 bg-blue-500 rounded-l-full"
              style={{
                left: `${trimStartPercent}%`,
                width: `${Math.max(0, playheadPercent - trimStartPercent)}%`,
              }}
            />
          )}

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

        <div className="flex items-center justify-between mb-4 text-sm">
          <div className="flex items-center gap-4">
            <span className="text-zinc-400">
              <span className="text-white font-mono">{formatTime(internalTime)}</span>
              <span className="mx-1">/</span>
              <span className="font-mono">{formatTime(clipDuration)}</span>
            </span>
          </div>
          <div className="flex items-center gap-2 text-zinc-400">
            <span className="text-green-400">In:</span>
            <span className="font-mono text-white">{formatTime(trimStart)}</span>
            <span className="text-red-400 ml-2">Out:</span>
            <span className="font-mono text-white">{formatTime(trimEnd)}</span>
            <span className="text-zinc-500 ml-2">({formatTime(trimmedDuration)} final)</span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2">
          <Button variant="ghost" size="sm" onClick={jumpToTrimStart} title="Jump to trim start [">
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
          <Button variant="ghost" size="sm" onClick={jumpToTrimEnd} title="Jump to trim end ]">
            ⏭
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ClipVideoPlayer(props: ClipVideoPlayerProps) {
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
          <div className="flex justify-center gap-2">
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

  return <ClipVideoPlayerInner {...props} />;
}
