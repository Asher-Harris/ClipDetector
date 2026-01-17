"use client";

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import {
  type AnalysisResult,
  type ClipStatusMap,
  type ClipWithStatus,
  type ClipCandidateResult,
  type ClipStatus,
  type TTSSettings,
  generateClipId,
} from "@/lib/types";
import { loadFromStorage, saveToStorage, STORAGE_KEYS } from "@/lib/storage";

type AppState = {
  analysisResult: AnalysisResult | null;
  clipStatuses: ClipStatusMap;
  clipsWithStatus: ClipWithStatus[];
  finalizedClipIds: string[];
};

type AppActions = {
  setAnalysisResult: (result: AnalysisResult) => void;
  clearAnalysisResult: () => void;
  setClipStatus: (clipId: string, status: ClipStatus) => void;
  updateTrim: (clipId: string, trimStart: number, trimEnd: number) => void;
  resetClipTrim: (clipId: string) => void;
  updateTTSSettings: (clipId: string, settings: TTSSettings) => void;
  markClipFinalized: (clipId: string) => void;
  unmarkClipFinalized: (clipId: string) => void;
  clearFinalizedClips: () => void;
};

const AppContext = createContext<(AppState & AppActions) | null>(null);

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}

function deriveClipsWithStatus(
  candidates: ClipCandidateResult[],
  statuses: ClipStatusMap
): ClipWithStatus[] {
  return candidates.map((candidate) => {
    const id = generateClipId(candidate);
    const statusInfo = statuses[id];
    return {
      ...candidate,
      id,
      status: statusInfo?.status || "pending",
      trimStart: statusInfo?.trimStart ?? candidate.clip_start,
      trimEnd: statusInfo?.trimEnd ?? candidate.clip_end,
      ttsSettings: statusInfo?.ttsSettings,
    };
  });
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [analysisResult, setAnalysisResultState] = useState<AnalysisResult | null>(null);
  const [clipStatuses, setClipStatuses] = useState<ClipStatusMap>({});
  const [finalizedClipIds, setFinalizedClipIds] = useState<string[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const storedAnalysis = loadFromStorage<AnalysisResult | null>(
      STORAGE_KEYS.ANALYSIS_RESULT,
      null
    );
    const storedStatuses = loadFromStorage<ClipStatusMap>(
      STORAGE_KEYS.CLIP_STATUSES,
      {}
    );
    const storedFinalized = loadFromStorage<string[]>(
      STORAGE_KEYS.FINALIZED_CLIPS,
      []
    );
    if (storedAnalysis) setAnalysisResultState(storedAnalysis);
    if (storedStatuses) setClipStatuses(storedStatuses);
    if (storedFinalized) setFinalizedClipIds(storedFinalized);
    setIsHydrated(true);
  }, []);

  // Persist to localStorage on change
  useEffect(() => {
    if (!isHydrated) return;
    saveToStorage(STORAGE_KEYS.ANALYSIS_RESULT, analysisResult);
  }, [analysisResult, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    saveToStorage(STORAGE_KEYS.CLIP_STATUSES, clipStatuses);
  }, [clipStatuses, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    saveToStorage(STORAGE_KEYS.FINALIZED_CLIPS, finalizedClipIds);
  }, [finalizedClipIds, isHydrated]);

  const setAnalysisResult = useCallback((result: AnalysisResult) => {
    setAnalysisResultState(result);
    // Reset clip statuses and finalized clips for new analysis
    setClipStatuses({});
    setFinalizedClipIds([]);
  }, []);

  const clearAnalysisResult = useCallback(() => {
    setAnalysisResultState(null);
    setClipStatuses({});
    setFinalizedClipIds([]);
  }, []);

  const setClipStatus = useCallback((clipId: string, status: ClipStatus) => {
    setClipStatuses((prev) => ({
      ...prev,
      [clipId]: {
        ...prev[clipId],
        status,
      },
    }));
  }, []);

  const updateTrim = useCallback((clipId: string, trimStart: number, trimEnd: number) => {
    setClipStatuses((prev) => ({
      ...prev,
      [clipId]: {
        ...prev[clipId],
        status: prev[clipId]?.status || "pending",
        trimStart,
        trimEnd,
      },
    }));
  }, []);

  const resetClipTrim = useCallback((clipId: string) => {
    setClipStatuses((prev) => {
      const { trimStart, trimEnd, ...rest } = prev[clipId] || { status: "pending" };
      return {
        ...prev,
        [clipId]: rest as ClipStatusMap[string],
      };
    });
  }, []);

  const updateTTSSettings = useCallback((clipId: string, settings: TTSSettings) => {
    setClipStatuses((prev) => ({
      ...prev,
      [clipId]: {
        ...prev[clipId],
        status: prev[clipId]?.status || "pending",
        ttsSettings: settings,
      },
    }));
  }, []);

  const markClipFinalized = useCallback((clipId: string) => {
    setFinalizedClipIds((prev) =>
      prev.includes(clipId) ? prev : [...prev, clipId]
    );
  }, []);

  const unmarkClipFinalized = useCallback((clipId: string) => {
    setFinalizedClipIds((prev) => prev.filter((id) => id !== clipId));
  }, []);

  const clearFinalizedClips = useCallback(() => {
    setFinalizedClipIds([]);
  }, []);

  const clipsWithStatus = analysisResult
    ? deriveClipsWithStatus(analysisResult.candidates, clipStatuses)
    : [];

  return (
    <AppContext.Provider
      value={{
        analysisResult,
        clipStatuses,
        clipsWithStatus,
        finalizedClipIds,
        setAnalysisResult,
        clearAnalysisResult,
        setClipStatus,
        updateTrim,
        resetClipTrim,
        updateTTSSettings,
        markClipFinalized,
        unmarkClipFinalized,
        clearFinalizedClips,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
