"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { ClipVideoPlayer } from "@/components/ClipVideoPlayer";
import { TTSControls } from "@/components/TTSControls";
import { ExportButton } from "@/components/ExportButton";
import { Button, Card } from "@/components/ui";
import { type TTSSettings } from "@/lib/types";
import { formatTime } from "@/lib/format";

export default function FinalizePage() {
  const router = useRouter();
  const {
    analysisResult,
    clipsWithStatus,
    finalizedClipIds,
    updateTrim,
    updateTTSSettings,
    markClipFinalized,
  } = useApp();

  const [currentIndex, setCurrentIndex] = useState(0);

  const approvedClips = useMemo(
    () => clipsWithStatus.filter((c) => c.status === "approved"),
    [clipsWithStatus]
  );

  const finalizedClips = useMemo(
    () => approvedClips.filter((c) => finalizedClipIds.includes(c.id)),
    [approvedClips, finalizedClipIds]
  );

  const currentClip = approvedClips[currentIndex];
  const isCurrentFinalized = currentClip ? finalizedClipIds.includes(currentClip.id) : false;
  const isFirstClip = currentIndex === 0;
  const isLastClip = currentIndex === approvedClips.length - 1;

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  }, [currentIndex]);

  const handleNext = useCallback(() => {
    if (currentClip) {
      markClipFinalized(currentClip.id);
    }
    if (currentIndex < approvedClips.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  }, [currentIndex, approvedClips.length, currentClip, markClipFinalized]);

  const handleSkip = useCallback(() => {
    if (currentIndex < approvedClips.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  }, [currentIndex, approvedClips.length]);

  const handleTrimStartChange = useCallback(
    (relativeTime: number) => {
      if (currentClip) {
        const absoluteTime = currentClip.clip_start + relativeTime;
        updateTrim(currentClip.id, absoluteTime, currentClip.trimEnd);
      }
    },
    [currentClip, updateTrim]
  );

  const handleTrimEndChange = useCallback(
    (relativeTime: number) => {
      if (currentClip) {
        const absoluteTime = currentClip.clip_start + relativeTime;
        updateTrim(currentClip.id, currentClip.trimStart, absoluteTime);
      }
    },
    [currentClip, updateTrim]
  );

  const handleTTSChange = useCallback(
    (settings: TTSSettings) => {
      if (currentClip) {
        updateTTSSettings(currentClip.id, settings);
      }
    },
    [currentClip, updateTTSSettings]
  );

  if (!analysisResult) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <Card className="p-8 text-center">
          <h2 className="text-xl font-semibold mb-4">No Analysis Results</h2>
          <p className="text-zinc-400 mb-6">
            Run an analysis first to review clip candidates.
          </p>
          <Button onClick={() => router.push("/")}>Go to Analysis</Button>
        </Card>
      </div>
    );
  }

  if (approvedClips.length === 0) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <Card className="p-8 text-center">
          <h2 className="text-xl font-semibold mb-4">No Approved Clips</h2>
          <p className="text-zinc-400 mb-6">
            Approve some clips in the review page first.
          </p>
          <Button onClick={() => router.push("/review")}>Go to Review</Button>
        </Card>
      </div>
    );
  }

  const vodFilename = analysisResult.videoPath.split("/").pop() || "vod";
  const allFinalized = currentIndex === approvedClips.length - 1 && isCurrentFinalized;

  const relativeTrimStart = currentClip.trimStart - currentClip.clip_start;
  const relativeTrimEnd = currentClip.trimEnd - currentClip.clip_start;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Finalize Clips</h1>
            <p className="text-zinc-400 text-sm mt-1">
              {vodFilename} - Clip {currentIndex + 1} of {approvedClips.length}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {finalizedClips.length > 0 && (
              <ExportButton
                clips={finalizedClips}
                vodFilename={vodFilename}
                vodPath={analysisResult.videoPath}
              />
            )}
            <Button variant="secondary" onClick={() => router.push("/review")}>
              Back to Review
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Progress Dots */}
        <div className="flex items-center justify-center gap-2">
          {approvedClips.map((clip, index) => {
            const isFinalized = finalizedClipIds.includes(clip.id);
            const isCurrent = index === currentIndex;
            return (
              <button
                key={clip.id}
                onClick={() => setCurrentIndex(index)}
                className={`w-3 h-3 rounded-full transition-all ${
                  isFinalized ? "bg-green-500" : "bg-zinc-600 hover:bg-zinc-500"
                } ${isCurrent ? "ring-2 ring-blue-500" : ""}`}
                title={`Clip ${index + 1}${isFinalized ? " (finalized)" : ""}`}
              />
            );
          })}
          <span className="ml-3 text-sm text-zinc-400">
            {finalizedClips.length} of {approvedClips.length} finalized
          </span>
        </div>

        {/* Video Player */}
        <ClipVideoPlayer
          vodPath={analysisResult.videoPath}
          clipStart={currentClip.clip_start}
          clipEnd={currentClip.clip_end}
          trimStart={relativeTrimStart}
          trimEnd={relativeTrimEnd}
          onTrimStartChange={handleTrimStartChange}
          onTrimEndChange={handleTrimEndChange}
        />

        {/* TTS Controls */}
        <Card className="p-4">
          <TTSControls
            settings={currentClip.ttsSettings}
            onChange={handleTTSChange}
          />
        </Card>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="secondary"
            onClick={handlePrevious}
            disabled={isFirstClip}
          >
            ← Previous
          </Button>

          <div className="flex items-center gap-3">
            {isCurrentFinalized ? (
              <span className="text-green-400 text-sm">✓ Finalized</span>
            ) : (
              <span className="text-zinc-500 text-sm">Not finalized</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={handleSkip} disabled={isLastClip}>
              Skip
            </Button>
            <Button variant="primary" onClick={handleNext}>
              {isLastClip
                ? isCurrentFinalized
                  ? "Done"
                  : "Mark Done"
                : "Mark Done →"}
            </Button>
          </div>
        </div>

        {/* Completion State */}
        {allFinalized && (
          <Card className="p-6 text-center bg-green-950/20 border-green-600/50">
            <h3 className="text-lg font-semibold text-green-400 mb-2">
              All Clips Finalized!
            </h3>
            <p className="text-zinc-400 mb-4">
              You have reviewed all {approvedClips.length} clips. Ready to export.
            </p>
            <ExportButton
              clips={finalizedClips}
              vodFilename={vodFilename}
              vodPath={analysisResult.videoPath}
            />
          </Card>
        )}
      </div>
    </div>
  );
}
