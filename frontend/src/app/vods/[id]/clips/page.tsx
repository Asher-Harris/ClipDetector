"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AppHeader, Spinner, ConfirmDialog } from "@/components/ui";
import { TwitchClipCard } from "@/components/TwitchClipCard";
import { ClipPlayerModal } from "@/components/ClipPlayerModal";
import { Pagination } from "@/components/Pagination";
import { getVodDetail, getVodClips, deleteTwitchClip, type ApiError } from "@/lib/api";
import type { TwitchVod, TwitchClip } from "@/lib/types";

type SortKey = "view_count" | "duration" | "vod_offset";

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 12 6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function formatDuration(duration: string): string {
  const match = duration.match(/(\d+)h(\d+)m(\d+)s/);
  if (match) {
    const [, h, m] = match;
    return `${h}h ${m}m`;
  }
  const minMatch = duration.match(/(\d+)m(\d+)s/);
  if (minMatch) return `${minMatch[1]}m`;
  return duration;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function sortClips(clips: TwitchClip[], sortKey: SortKey): TwitchClip[] {
  return [...clips].sort((a, b) => {
    switch (sortKey) {
      case "view_count":
        return b.view_count - a.view_count;
      case "duration":
        return b.duration - a.duration;
      case "vod_offset":
        return (a.vod_offset ?? Infinity) - (b.vod_offset ?? Infinity);
    }
  });
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "view_count", label: "Views" },
  { key: "vod_offset", label: "VOD Offset" },
  { key: "duration", label: "Duration" },
];

export default function VodClipsPage() {
  const params = useParams();
  const vodId = params.id as string;
  const [vod, setVod] = useState<TwitchVod | null>(null);
  const [clips, setClips] = useState<TwitchClip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("view_count");
  const [showDownloadedOnly, setShowDownloadedOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeClip, setActiveClip] = useState<TwitchClip | null>(null);
  const [clipToDelete, setClipToDelete] = useState<TwitchClip | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [vodData, clipsData] = await Promise.all([
        getVodDetail(vodId),
        getVodClips(vodId),
      ]);
      setVod(vodData);
      setClips(clipsData.clips);
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message || "Failed to load clips");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [vodId]);

  const PAGE_SIZE = 24;
  const downloadedCount = clips.filter((c) => c.downloaded).length;
  const filteredClips = showDownloadedOnly ? clips.filter((c) => c.downloaded) : clips;
  const sortedClips = sortClips(filteredClips, sortKey);
  const totalPages = Math.ceil(sortedClips.length / PAGE_SIZE);
  const paginatedClips = sortedClips.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleSortChange = (key: SortKey) => {
    setSortKey(key);
    setCurrentPage(1);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDeleteClip = async () => {
    if (!clipToDelete) return;
    setIsDeleting(true);
    try {
      await deleteTwitchClip(clipToDelete.id);
      setClipToDelete(null);
      loadData();
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message || "Failed to delete clip");
      setClipToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-base">
      <AppHeader currentPage="vods" />

      <main className="max-w-[1800px] mx-auto px-6 py-6">
        <Link
          href="/vods"
          className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg-default transition-colors mb-4"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Back to VODs
        </Link>

        {vod && (
          <div className="flex items-center gap-4 mb-6 p-4 bg-bg-surface rounded-lg border border-border-default">
            <img
              src={vod.thumbnail_url}
              alt=""
              className="w-32 h-18 object-cover rounded flex-shrink-0"
            />
            <div className="min-w-0 flex-1">
              <h1 className="text-sm font-medium text-fg-default truncate">{vod.title}</h1>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-fg-muted">
                {vod.channel_profile_image_url && (
                  <img src={vod.channel_profile_image_url} alt="" className="w-4 h-4 rounded-full" />
                )}
                <span className="font-medium text-fg-secondary">
                  {vod.channel_display_name || vod.channel_login}
                </span>
                <span className="text-fg-faint">·</span>
                <span>{formatDuration(vod.duration)}</span>
                <span className="text-fg-faint">·</span>
                <span>{formatDate(vod.created_at)}</span>
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Spinner size="lg" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-sm text-error mb-2">{error}</p>
            <button
              onClick={loadData}
              className="text-xs text-accent hover:text-accent-hover transition-colors"
            >
              Try again
            </button>
          </div>
        ) : clips.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <h3 className="text-sm font-medium text-fg-default mb-1">No clips found</h3>
            <p className="text-xs text-fg-muted max-w-xs">
              No Twitch clips were created during this VOD
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-1.5">
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    onClick={() => handleSortChange(option.key)}
                    className={`px-3 h-7 text-xs font-medium rounded-md transition-colors ${
                      sortKey === option.key
                        ? "bg-accent text-white"
                        : "bg-bg-surface hover:bg-bg-hover text-fg-secondary hover:text-fg-default border border-border-default"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
                {downloadedCount > 0 && (
                  <>
                    <div className="w-px h-4 bg-border-default mx-1" />
                    <button
                      onClick={() => {
                        setShowDownloadedOnly((v) => !v);
                        setCurrentPage(1);
                      }}
                      className={`px-3 h-7 text-xs font-medium rounded-md transition-colors ${
                        showDownloadedOnly
                          ? "bg-accent text-white"
                          : "bg-bg-surface hover:bg-bg-hover text-fg-secondary hover:text-fg-default border border-border-default"
                      }`}
                    >
                      Downloaded
                    </button>
                  </>
                )}
              </div>
              <div className="text-xs text-fg-muted tabular-nums">
                {downloadedCount > 0 && `${downloadedCount} downloaded · `}
                {showDownloadedOnly ? `${filteredClips.length} of ${clips.length}` : clips.length} clips
                {totalPages > 1 && ` · Page ${currentPage} of ${totalPages}`}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
              {paginatedClips.map((clip) => (
                <TwitchClipCard
                  key={clip.id}
                  clip={clip}
                  channelLogin={vod?.channel_login || ""}
                  onDownloaded={loadData}
                  onPlay={setActiveClip}
                  onDelete={setClipToDelete}
                />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="mt-6">
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={handlePageChange}
                />
              </div>
            )}
          </>
        )}
      </main>

      <ClipPlayerModal clip={activeClip} onClose={() => setActiveClip(null)} />
      <ConfirmDialog
        isOpen={clipToDelete !== null}
        title="Delete Clip"
        message={`Delete the downloaded clip "${clipToDelete?.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteClip}
        onCancel={() => setClipToDelete(null)}
        isLoading={isDeleting}
      />
    </div>
  );
}
