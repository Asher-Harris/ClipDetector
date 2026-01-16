// API Response Types (matching backend models)
export type ClipCandidateResult = {
  timestamp: number;
  score: number;
  signals: string[];
  clip_start: number;
  clip_end: number;
};

export type FullAnalysisResponse = {
  video_path: string;
  chat_path: string;
  candidates: ClipCandidateResult[];
  total_candidates: number;
  config: Record<string, number>;
};

export type FileListResponse = {
  vods: string[];
  chats: string[];
};

// Frontend State Types
export type ClipStatus = "pending" | "approved" | "rejected";

export type ClipWithStatus = ClipCandidateResult & {
  id: string;
  status: ClipStatus;
  trimStart: number;
  trimEnd: number;
};

export type AnalysisResult = {
  videoPath: string;
  chatPath: string;
  candidates: ClipCandidateResult[];
  analyzedAt: string;
};

export type ClipStatusMap = {
  [clipId: string]: {
    status: ClipStatus;
    trimStart?: number;
    trimEnd?: number;
  };
};

// Signal type for badge rendering
export type SignalType = "audio" | "velocity_spike" | "emote_flood";

export const SIGNAL_LABELS: Record<SignalType, string> = {
  audio: "Audio",
  velocity_spike: "Chat",
  emote_flood: "Emotes",
};

export const SIGNAL_COLORS: Record<SignalType, string> = {
  audio: "bg-blue-500",
  velocity_spike: "bg-purple-500",
  emote_flood: "bg-yellow-500",
};

// Generate deterministic clip ID
export function generateClipId(candidate: ClipCandidateResult): string {
  return `clip_${candidate.timestamp.toFixed(2)}_${candidate.score.toFixed(2)}`;
}
