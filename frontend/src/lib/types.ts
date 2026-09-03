// UI Types
export type SelectOption = {
  value: string;
  label: string;
};

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
  vodId?: string;
  vodTitle?: string;
  channelLogin?: string;
};

export type ClipStatusMap = {
  [clipId: string]: {
    status: ClipStatus;
    trimStart?: number;
    trimEnd?: number;
  };
};

// Signal type for badge rendering
export type SignalType = "audio" | "chat" | "speech_keyword" | "speech_rate" | "clip_popular" | "clip_density";

export const SIGNAL_LABELS: Record<SignalType, string> = {
  audio: "Audio",
  chat: "Chat",
  speech_keyword: "Speech",
  speech_rate: "Fast Talk",
  clip_popular: "Clip",
  clip_density: "Clip Density",
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
  speech_keyword_weight?: number;
  speech_rate_weight?: number;
  clip_popular_weight?: number;
  clip_density_weight?: number;
};

export type ProfileCreateRequest = {
  name: string;
  audio_weight: number;
  chat_weight: number;
  audio_threshold_multiplier: number;
  chat_threshold: number;
  speech_keyword_weight?: number;
  speech_rate_weight?: number;
  clip_popular_weight?: number;
  clip_density_weight?: number;
};

export type ProfileUpdateRequest = Partial<ProfileCreateRequest>;

export const DEFAULT_PROFILE_VALUES: ProfileCreateRequest = {
  name: "",
  audio_weight: 1.0,
  chat_weight: 1.5,
  audio_threshold_multiplier: 2.5,
  chat_threshold: 3.0,
  speech_keyword_weight: 1.5,
  speech_rate_weight: 1.0,
  clip_popular_weight: 3.5,
  clip_density_weight: 2.5,
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
  speech_keyword_weight: {
    label: "Speech Keyword Weight",
    description: "Weight for detected excitement phrases",
    min: 0,
    max: 5,
    step: 0.1,
    category: "weights",
  },
  speech_rate_weight: {
    label: "Speech Rate Weight",
    description: "Weight for fast speech detection",
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
  clip_popular_weight: {
    label: "Clip Popular Weight",
    description: "Weight for high-view Twitch clips",
    min: 0,
    max: 5,
    step: 0.1,
    category: "weights",
  },
  clip_density_weight: {
    label: "Clip Density Weight",
    description: "Weight for clusters of Twitch clips",
    min: 0,
    max: 5,
    step: 0.1,
    category: "weights",
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

// Twitch VOD Types
export type TwitchVod = {
  id: string;
  channel_login: string;
  title: string;
  created_at: string;
  duration: string;
  thumbnail_url: string;
  view_count: number;
  downloaded: boolean;
  video_filename: string | null;
  chat_filename: string | null;
  channel_display_name?: string;
  channel_profile_image_url?: string;
  duration_seconds?: number;
  video_path?: string;
  chat_path?: string;
};

export type TwitchChannel = {
  login: string;
  display_name: string;
  profile_image_url?: string;
};

export type VodRefreshError = {
  channel: string;
  error: string;
};

export type VodListResponse = {
  channels: TwitchChannel[];
  vods: TwitchVod[];
  errors?: VodRefreshError[];
};

export type TwitchClip = {
  id: string;
  video_id: string | null;
  vod_offset: number | null;
  view_count: number;
  duration: number;
  created_at: string;
  title: string;
  creator_name: string;
  thumbnail_url: string | null;
  downloaded: boolean;
  filename: string | null;
};

export type VodClipsResponse = {
  vod_id: string;
  clips: TwitchClip[];
  total: number;
};

export type LocalClip = {
  filename: string;
  file_size: number;
  created_at: string;
  duration: number;
};

export type DownloadProgress = {
  stage: "queued" | "video" | "chat";
  percent: number;
  message: string;
};

export type ActiveDownloadInfo = {
  stage: "queued" | "video" | "chat";
  videoPercent: number;
  chatPercent: number;
  message: string;
};

export type ActiveDownloadsResponse = {
  downloads: Record<string, ActiveDownloadInfo>;
};
