"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import type { DownloadProgress } from "@/lib/types";
import {
  downloadVodWithProgress,
  cancelVodDownload,
  getActiveDownloads,
  type ApiError,
} from "@/lib/api";

type DownloadState = {
  isDownloading: boolean;
  progress: {
    videoPercent: number;
    chatPercent: number;
    stage: "queued" | "video" | "chat";
    message: string;
  } | null;
  error: string | null;
};

type DownloadsMap = Record<string, DownloadState>;

function withoutDownload(downloads: DownloadsMap, vodId: string): DownloadsMap {
  const remaining = { ...downloads };
  delete remaining[vodId];
  return remaining;
}

type DownloadContextValue = {
  downloads: DownloadsMap;
  startDownload: (vodId: string) => void;
  cancelDownload: (vodId: string) => void;
  clearError: (vodId: string) => void;
};

const DownloadContext = createContext<DownloadContextValue | null>(null);

export function useDownloads() {
  const context = useContext(DownloadContext);
  if (!context) {
    throw new Error("useDownloads must be used within a DownloadProvider");
  }
  return context;
}

export function useDownload(vodId: string) {
  const { downloads, startDownload, cancelDownload, clearError } = useDownloads();
  const state = downloads[vodId];

  return {
    isDownloading: state?.isDownloading ?? false,
    progress: state?.progress ?? null,
    error: state?.error ?? null,
    startDownload: () => startDownload(vodId),
    cancelDownload: () => cancelDownload(vodId),
    clearError: () => clearError(vodId),
  };
}

export function DownloadProvider({ children }: { children: ReactNode }) {
  const [downloads, setDownloads] = useState<DownloadsMap>({});
  const abortControllersRef = useRef<Record<string, AbortController>>({});
  const activeConnectionsRef = useRef<Set<string>>(new Set());

  const connectToDownload = useCallback((vodId: string, isReconnect: boolean) => {
    if (activeConnectionsRef.current.has(vodId)) {
      return;
    }
    activeConnectionsRef.current.add(vodId);

    const controller = new AbortController();
    abortControllersRef.current[vodId] = controller;

    downloadVodWithProgress(
      vodId,
      (p: DownloadProgress) => {
        setDownloads((prev) => {
          const currentState = prev[vodId];
          if (!currentState) return prev;

          const newProgress = currentState.progress ?? {
            videoPercent: 0,
            chatPercent: 0,
            stage: "queued" as const,
            message: "",
          };

          if (p.stage === "video") {
            return {
              ...prev,
              [vodId]: {
                ...currentState,
                progress: {
                  ...newProgress,
                  videoPercent: Math.max(newProgress.videoPercent, p.percent),
                  stage: "video",
                  message: p.message,
                },
              },
            };
          } else if (p.stage === "chat") {
            return {
              ...prev,
              [vodId]: {
                ...currentState,
                progress: {
                  ...newProgress,
                  chatPercent: Math.max(newProgress.chatPercent, p.percent),
                  stage: "chat",
                  message: p.message,
                },
              },
            };
          } else if (p.stage === "queued") {
            return {
              ...prev,
              [vodId]: {
                ...currentState,
                progress: {
                  ...newProgress,
                  stage: "queued",
                  message: p.message,
                },
              },
            };
          }
          return prev;
        });
      },
      controller.signal
    )
      .then(() => {
        setDownloads((prev) => withoutDownload(prev, vodId));
        delete abortControllersRef.current[vodId];
        activeConnectionsRef.current.delete(vodId);
      })
      .catch((err) => {
        activeConnectionsRef.current.delete(vodId);

        if (err instanceof DOMException && err.name === "AbortError") {
          setDownloads((prev) => withoutDownload(prev, vodId));
          return;
        }

        const apiError = err as ApiError;

        // If reconnecting and we get a 409 (already in progress) or 404,
        // the download may have completed - just remove from state
        if (isReconnect && (apiError.status === 409 || apiError.status === 404)) {
          setDownloads((prev) => withoutDownload(prev, vodId));
          return;
        }

        setDownloads((prev) => ({
          ...prev,
          [vodId]: {
            isDownloading: false,
            progress: null,
            error: apiError.message || "Download failed",
          },
        }));
        delete abortControllersRef.current[vodId];
      });
  }, []);

  useEffect(() => {
    getActiveDownloads()
      .then((response) => {
        const restoredDownloads: DownloadsMap = {};
        for (const [vodId, info] of Object.entries(response.downloads)) {
          restoredDownloads[vodId] = {
            isDownloading: true,
            progress: {
              videoPercent: info.videoPercent,
              chatPercent: info.chatPercent,
              stage: info.stage,
              message: info.message,
            },
            error: null,
          };
        }
        if (Object.keys(restoredDownloads).length > 0) {
          setDownloads(restoredDownloads);
          for (const vodId of Object.keys(restoredDownloads)) {
            connectToDownload(vodId, true);
          }
        }
      })
      .catch(() => {
        // Ignore errors on initial fetch
      });
  }, [connectToDownload]);

  const startDownload = useCallback(
    (vodId: string) => {
      if (downloads[vodId]?.isDownloading) return;

      setDownloads((prev) => ({
        ...prev,
        [vodId]: {
          isDownloading: true,
          progress: {
            videoPercent: 0,
            chatPercent: 0,
            stage: "queued",
            message: "Starting...",
          },
          error: null,
        },
      }));

      connectToDownload(vodId, false);
    },
    [downloads, connectToDownload]
  );

  const cancelDownload = useCallback(async (vodId: string) => {
    const controller = abortControllersRef.current[vodId];
    if (controller) {
      controller.abort();
    }
    try {
      await cancelVodDownload(vodId);
    } catch {
      // Ignore errors when cancelling
    }
    setDownloads((prev) => withoutDownload(prev, vodId));
    delete abortControllersRef.current[vodId];
    activeConnectionsRef.current.delete(vodId);
  }, []);

  const clearError = useCallback((vodId: string) => {
    setDownloads((prev) => withoutDownload(prev, vodId));
  }, []);

  return (
    <DownloadContext.Provider
      value={{
        downloads,
        startDownload,
        cancelDownload,
        clearError,
      }}
    >
      {children}
    </DownloadContext.Provider>
  );
}
