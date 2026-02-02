"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { ClipList } from "@/components/ClipList";
import { VideoPlayer } from "@/components/VideoPlayer";
import { Timeline } from "@/components/Timeline";
import { ExportButton } from "@/components/ExportButton";
import { AppHeader, Button, Card } from "@/components/ui";

export default function ReviewPage() {
  const router = useRouter();
  const {
    analysisResult,
    clipsWithStatus,
    updateTrim,
    clearAnalysisResult,
  } = useApp();

  const editedClips = useMemo(
    () =>
      clipsWithStatus.filter(
        (c) => c.trimStart !== c.clip_start || c.trimEnd !== c.clip_end
      ),
    [clipsWithStatus]
  );

  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [viewportCenter, setViewportCenter] = useState(50);

  const selectedClip = useMemo(
    () => clipsWithStatus.find((c) => c.id === selectedClipId),
    [clipsWithStatus, selectedClipId]
  );

  const timelineMarkers = useMemo(
    () =>
      clipsWithStatus.map((clip) => ({
        id: clip.id,
        time: clip.timestamp,
        score: clip.score,
      })),
    [clipsWithStatus]
  );

  const handleSelectClip = useCallback(
    (id: string) => {
      setSelectedClipId(id);
      const clip = clipsWithStatus.find((c) => c.id === id);
      if (clip) {
        setCurrentTime(clip.trimStart);
      }
    },
    [clipsWithStatus]
  );

  const handleReset = useCallback(
    (id: string) => {
      const clip = clipsWithStatus.find((c) => c.id === id);
      if (clip) {
        updateTrim(id, clip.clip_start, clip.clip_end);
      }
    },
    [clipsWithStatus, updateTrim]
  );

  const handleTrimStartChange = useCallback(
    (time: number) => {
      if (selectedClipId && selectedClip) {
        updateTrim(selectedClipId, time, selectedClip.trimEnd);
      }
    },
    [selectedClipId, selectedClip, updateTrim]
  );

  const handleTrimEndChange = useCallback(
    (time: number) => {
      if (selectedClipId && selectedClip) {
        updateTrim(selectedClipId, selectedClip.trimStart, time);
      }
    },
    [selectedClipId, selectedClip, updateTrim]
  );

  const handleSeek = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  const handleMarkerClick = useCallback(
    (id: string) => {
      handleSelectClip(id);
    },
    [handleSelectClip]
  );

  if (!analysisResult) {
    return (
      <div className="min-h-screen bg-bg-base text-fg-default flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-bg-surface border border-border-default flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-fg-muted">
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h2 className="text-base font-medium text-fg-default mb-1">No Analysis Results</h2>
          <p className="text-sm text-fg-muted mb-6">
            Run an analysis first to review clips
          </p>
          <Button onClick={() => router.push("/")}>Go to Analysis</Button>
        </div>
      </div>
    );
  }

  const vodFilename = analysisResult.videoPath.split("/").pop() || "vod";

  return (
    <div className="min-h-screen bg-bg-base text-fg-default">
      <AppHeader currentPage="review" showReviewLink />

      <div className="max-w-[1800px] mx-auto px-6 py-6">
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-4 xl:col-span-3">
            <div className="sticky top-20 h-[calc(100vh-120px)] flex flex-col">
              <ClipList
                clips={clipsWithStatus}
                selectedClipId={selectedClipId}
                onSelectClip={handleSelectClip}
                onReset={handleReset}
                vodFilename={vodFilename}
                vodPath={analysisResult.videoPath}
                editedClips={editedClips}
              />
            </div>
          </div>

          <div className="col-span-12 lg:col-span-8 xl:col-span-9 space-y-4">
            {selectedClip ? (
              <VideoPlayer
                vodPath={analysisResult.videoPath}
                currentTime={currentTime}
                trimStart={selectedClip.trimStart}
                trimEnd={selectedClip.trimEnd}
                onTimeUpdate={setCurrentTime}
                onDurationChange={setDuration}
                onSeek={handleSeek}
                onTrimStartChange={handleTrimStartChange}
                onTrimEndChange={handleTrimEndChange}
                zoom={zoom}
                viewportCenter={viewportCenter}
                onZoomChange={setZoom}
                onViewportCenterChange={setViewportCenter}
              />
            ) : (
              <div className="aspect-video bg-bg-surface border border-border-default rounded-lg flex items-center justify-center">
                <div className="text-center">
                  <div className="w-10 h-10 mx-auto mb-3 rounded-lg bg-bg-overlay flex items-center justify-center">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-fg-faint">
                      <polygon points="5 3 19 12 5 21 5 3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <p className="text-sm text-fg-muted">Select a clip to preview</p>
                </div>
              </div>
            )}

            <Timeline
              duration={duration}
              currentTime={currentTime}
              markers={timelineMarkers}
              selectedMarkerId={selectedClipId}
              trimStart={selectedClip?.trimStart}
              trimEnd={selectedClip?.trimEnd}
              onSeek={handleSeek}
              onMarkerClick={handleMarkerClick}
              zoom={zoom}
              viewportCenter={viewportCenter}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
