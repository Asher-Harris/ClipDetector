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
export type SignalType = "audio" | "chat";

export const SIGNAL_LABELS: Record<SignalType, string> = {
  audio: "Audio",
  chat: "Chat",
};

export const SIGNAL_COLORS: Record<SignalType, string> = {
  audio: "bg-blue-500",
  chat: "bg-purple-500",
};

// Generate deterministic clip ID
export function generateClipId(candidate: ClipCandidateResult): string {
  return `clip_${candidate.timestamp.toFixed(2)}_${candidate.score.toFixed(2)}`;
}

// Clip Export Types
export type ClipExportRequest = {
  vod_path: string;
  start_time: number;
  end_time: number;
  output_filename: string;
};

export type ClipExportResponse = {
  success: boolean;
  output_path: string;
  duration: number;
  file_size: number;
};

export type ExportResult = {
  clipId: string;
  status: "success" | "error";
  outputPath?: string;
  error?: string;
};

// Profile Types
export type Profile = {
  id: string;
  name: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  audio_weight: number;
  chat_weight: number;
  audio_threshold_multiplier: number;
  chat_threshold: number;
};

export type ProfileCreateRequest = {
  name: string;
  audio_weight: number;
  chat_weight: number;
  audio_threshold_multiplier: number;
  chat_threshold: number;
};

export type ProfileUpdateRequest = Partial<ProfileCreateRequest>;

export const DEFAULT_PROFILE_VALUES: ProfileCreateRequest = {
  name: "",
  audio_weight: 1.0,
  chat_weight: 1.5,
  audio_threshold_multiplier: 2.5,
  chat_threshold: 3.0,
};

export type ProfileParamMeta = {
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  category: "weights" | "thresholds";
};

export const PROFILE_PARAMS: Record<
  keyof Omit<ProfileCreateRequest, "name">,
  ProfileParamMeta
> = {
  audio_weight: {
    label: "Audio Weight",
    description: "Weight for audio spike signals",
    min: 0,
    max: 5,
    step: 0.1,
    category: "weights",
  },
  chat_weight: {
    label: "Chat Weight",
    description: "Weight for chat activity signals",
    min: 0,
    max: 5,
    step: 0.1,
    category: "weights",
  },
  audio_threshold_multiplier: {
    label: "Audio Threshold",
    description: "Loudness must exceed average by this factor",
    min: 1,
    max: 10,
    step: 0.1,
    category: "thresholds",
  },
  chat_threshold: {
    label: "Chat Threshold",
    description: "Chat rate must exceed baseline by this factor",
    min: 1,
    max: 10,
    step: 0.1,
    category: "thresholds",
  },
};
