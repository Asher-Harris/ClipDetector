"use client";

import { useEffect, useState } from "react";
import { AppHeader, Spinner, ConfirmDialog } from "@/components/ui";
import { LocalClipCard } from "@/components/LocalClipCard";
import { ClipPlayerModal } from "@/components/ClipPlayerModal";
import { Pagination } from "@/components/Pagination";
import { listLocalClips, deleteLocalClip, type ApiError } from "@/lib/api";
import type { LocalClip } from "@/lib/types";

type SortKey = "date_desc" | "date_asc" | "size" | "duration";

function sortClips(clips: LocalClip[], sortKey: SortKey): LocalClip[] {
  return [...clips].sort((a, b) => {
    switch (sortKey) {
      case "date_desc":
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case "date_asc":
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      case "size":
        return b.file_size - a.file_size;
      case "duration":
        return b.duration - a.duration;
    }
  });
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "date_desc", label: "Newest" },
  { key: "date_asc", label: "Oldest" },
  { key: "size", label: "Size" },
  { key: "duration", label: "Duration" },
];

export default function ClipsPage() {
  const [clips, setClips] = useState<LocalClip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("date_desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [activeClip, setActiveClip] = useState<LocalClip | null>(null);
  const [clipToDelete, setClipToDelete] = useState<LocalClip | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listLocalClips();
      setClips(data);
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message || "Failed to load clips");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const PAGE_SIZE = 24;
  const sortedClips = sortClips(clips, sortKey);
  const totalPages = Math.ceil(sortedClips.length / PAGE_SIZE);
  const paginatedClips = sortedClips.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

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
      await deleteLocalClip(clipToDelete.filename);
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

  const playableClip = activeClip
    ? { filename: activeClip.filename, title: activeClip.filename, duration: activeClip.duration }
    : null;

  return (
    <div className="min-h-screen bg-bg-base">
      <AppHeader currentPage="clips" />

      <main className="max-w-[1800px] mx-auto px-6 py-6">
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
            <h3 className="text-sm font-medium text-fg-default mb-1">No clips yet</h3>
            <p className="text-xs text-fg-muted max-w-xs">
              Exported clips will appear here. Analyze a VOD and export clips to get started.
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
              </div>
              <div className="text-xs text-fg-muted tabular-nums">
                {clips.length} clip{clips.length !== 1 && "s"}
                {totalPages > 1 && ` · Page ${currentPage} of ${totalPages}`}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
              {paginatedClips.map((clip) => (
                <LocalClipCard
                  key={clip.filename}
                  clip={clip}
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

      <ClipPlayerModal clip={playableClip} onClose={() => setActiveClip(null)} />
      <ConfirmDialog
        isOpen={clipToDelete !== null}
        title="Delete Clip"
        message={`Delete "${clipToDelete?.filename}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteClip}
        onCancel={() => setClipToDelete(null)}
        isLoading={isDeleting}
      />
    </div>
  );
}
