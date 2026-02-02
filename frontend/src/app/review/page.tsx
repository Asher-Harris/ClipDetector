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

  const handleNewAnalysis = () => {
    clearAnalysisResult();
    router.push("/");
  };

  if (!analysisResult) {
    return (
      <div className="min-h-screen bg-bg-base text-fg-default flex items-center justify-center">
        <Card className="p-8 text-center">
          <h2 className="text-xl font-semibold mb-4">No Analysis Results</h2>
          <p className="text-fg-secondary mb-6">
            Run an analysis first to review clip candidates.
          </p>
          <Button onClick={() => router.push("/")}>Go to Analysis</Button>
        </Card>
      </div>
    );
  }

  const vodFilename = analysisResult.videoPath.split("/").pop() || "vod";

  return (
    <div className="min-h-screen bg-bg-base text-fg-default">
      <AppHeader currentPage="review" showReviewLink />

      <div className="border-b border-border-subtle bg-bg-base">
        <div className="max-w-[1800px] mx-auto px-6 h-12 flex items-center justify-between">
          <p className="text-sm text-fg-muted">
            {vodFilename} · {clipsWithStatus.length} candidates
          </p>
          <div className="flex items-center gap-2">
            <ExportButton
              clips={editedClips}
              vodFilename={vodFilename}
              vodPath={analysisResult.videoPath}
            />
          </div>
        </div>
      </div>

      <div className="max-w-[1800px] mx-auto p-6">
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-4 xl:col-span-3">
            <div className="sticky top-20 h-[calc(100vh-120px)] flex flex-col">
              <ClipList
                clips={clipsWithStatus}
                selectedClipId={selectedClipId}
                onSelectClip={handleSelectClip}
                onReset={handleReset}
              />
            </div>
          </div>

          <div className="col-span-12 lg:col-span-8 xl:col-span-9 space-y-6">
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
              <Card className="p-8 text-center aspect-video flex items-center justify-center">
                <p className="text-fg-secondary">
                  Select a clip from the list to preview and trim
                </p>
              </Card>
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
