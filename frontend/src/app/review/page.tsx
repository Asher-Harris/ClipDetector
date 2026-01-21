"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { ClipList } from "@/components/ClipList";
import { VideoPlayer } from "@/components/VideoPlayer";
import { Timeline } from "@/components/Timeline";
import { ExportButton } from "@/components/ExportButton";
import { Button, Card } from "@/components/ui";

export default function ReviewPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const {
    analysisResult,
    clipsWithStatus,
    setClipStatus,
    updateTrim,
    clearAnalysisResult,
  } = useApp();

  const approvedClips = useMemo(
    () => clipsWithStatus.filter((c) => c.status === "approved"),
    [clipsWithStatus]
  );

  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Find selected clip
  const selectedClip = useMemo(
    () => clipsWithStatus.find((c) => c.id === selectedClipId),
    [clipsWithStatus, selectedClipId]
  );

  // Timeline markers
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

  const handleApprove = useCallback(
    (id: string) => {
      const clip = clipsWithStatus.find((c) => c.id === id);
      if (clip?.status === "approved") {
        setClipStatus(id, "pending");
      } else {
        setClipStatus(id, "approved");
        addToast("success", "Clip approved");
      }
    },
    [clipsWithStatus, setClipStatus, addToast]
  );

  const handleReject = useCallback(
    (id: string) => {
      const clip = clipsWithStatus.find((c) => c.id === id);
      if (clip?.status === "rejected") {
        setClipStatus(id, "pending");
      } else {
        setClipStatus(id, "rejected");
      }
    },
    [clipsWithStatus, setClipStatus]
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

  // No analysis result - redirect to home
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

  // Extract VOD filename from path
  const vodFilename = analysisResult.videoPath.split("/").pop() || "vod";

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-[1800px] mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Review Clips</h1>
            <p className="text-zinc-400 text-sm mt-1">
              {vodFilename} - {clipsWithStatus.length} candidates found
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ExportButton
              clips={approvedClips}
              vodFilename={vodFilename}
              vodPath={analysisResult.videoPath}
            />
            <Button variant="secondary" onClick={handleNewAnalysis}>
              New Analysis
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-[1800px] mx-auto p-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Left Panel - Clip List */}
          <div className="col-span-12 lg:col-span-4 xl:col-span-3">
            <div className="sticky top-6 h-[calc(100vh-120px)] flex flex-col">
              <ClipList
                clips={clipsWithStatus}
                selectedClipId={selectedClipId}
                onSelectClip={handleSelectClip}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            </div>
          </div>

          {/* Right Panel - Video and Controls */}
          <div className="col-span-12 lg:col-span-8 xl:col-span-9 space-y-6">
            {/* Video Player with integrated trim controls */}
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
              />
            ) : (
              <Card className="p-8 text-center aspect-video flex items-center justify-center">
                <p className="text-zinc-400">
                  Select a clip from the list to preview and trim
                </p>
              </Card>
            )}

            {/* Timeline */}
            <Timeline
              duration={duration}
              currentTime={currentTime}
              markers={timelineMarkers}
              selectedMarkerId={selectedClipId}
              trimStart={selectedClip?.trimStart}
              trimEnd={selectedClip?.trimEnd}
              onSeek={handleSeek}
              onMarkerClick={handleMarkerClick}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
