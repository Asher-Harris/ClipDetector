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
  ttsSettings?: TTSSettings;
};

export type AnalysisResult = {
  videoPath: string;
  chatPath: string;
  candidates: ClipCandidateResult[];
  analyzedAt: string;
};

export type TTSVoice = "en-GB-RyanNeural" | "en-US-AndrewNeural";

export type TTSSettings = {
  text: string;
  voice: TTSVoice;
  speed: number;
  avatar?: string;
};

export const TTS_VOICES: { value: TTSVoice; label: string }[] = [
  { value: "en-GB-RyanNeural", label: "British (Ryan)" },
  { value: "en-US-AndrewNeural", label: "American (Andrew)" },
];

export const DEFAULT_TTS: TTSSettings = {
  text: "",
  voice: "en-GB-RyanNeural",
  speed: 1.0,
};

export type ClipStatusMap = {
  [clipId: string]: {
    status: ClipStatus;
    trimStart?: number;
    trimEnd?: number;
    ttsSettings?: TTSSettings;
  };
};

// Signal type for badge rendering
export type SignalType = "audio" | "chat" | "speech_keyword" | "speech_rate";

export const SIGNAL_LABELS: Record<SignalType, string> = {
  audio: "Audio",
  chat: "Chat",
  speech_keyword: "Speech",
  speech_rate: "Fast Talk",
};

export const SIGNAL_COLORS: Record<SignalType, string> = {
  audio: "bg-blue-500",
  chat: "bg-purple-500",
  speech_keyword: "bg-green-500",
  speech_rate: "bg-yellow-500",
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
  introPath?: string;
  introVideoPath?: string;
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
};

export type ProfileCreateRequest = {
  name: string;
  audio_weight: number;
  chat_weight: number;
  audio_threshold_multiplier: number;
  chat_threshold: number;
  speech_keyword_weight?: number;
  speech_rate_weight?: number;
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
  chat_threshold: {
    label: "Chat Threshold",
    description: "Chat rate must exceed baseline by this factor",
    min: 1,
    max: 10,
    step: 0.1,
    category: "thresholds",
  },
};

// TTS API Types
export type TTSPreviewRequest = {
  text: string;
  voice: TTSVoice;
  speed: number;
};

export type TTSGenerateRequest = TTSPreviewRequest & {
  output_filename: string;
  avatar?: string;
};

export type TTSGenerateResponse = {
  success: boolean;
  output_path?: string;
  duration_seconds: number;
  file_size: number;
  video_path?: string;
};

export type AvatarListResponse = {
  avatars: string[];
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
};

export type TwitchChannel = {
  login: string;
  display_name: string;
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

export type DownloadProgress = {
  stage: "video" | "chat";
  percent: number;
  message: string;
};
