import type {
  FileListResponse,
  FullAnalysisResponse,
  ClipExportRequest,
  ClipExportResponse,
  Profile,
  ProfileCreateRequest,
  ProfileUpdateRequest,
  TTSPreviewRequest,
  TTSGenerateRequest,
  TTSGenerateResponse,
  AvatarListResponse,
  VodListResponse,
  DownloadProgress,
  ActiveDownloadsResponse,
  TwitchVod,
} from "./types";

const API_BASE = "http://localhost:8000";

export type ApiError = {
  status: number;
  message: string;
  detail?: string;
};

async function apiRequest<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw {
      status: response.status,
      message: error.detail || "Request failed",
      detail: error.detail,
    } as ApiError;
  }

  return response.json();
}

export async function checkHealth(): Promise<{ status: string; service: string }> {
  return apiRequest("/health");
}

export type AppConfig = {
  features: {
    speech_analysis: boolean;
  };
};

export async function getConfig(): Promise<AppConfig> {
  return apiRequest("/api/config");
}

export async function listFiles(): Promise<FileListResponse> {
  return apiRequest("/api/files");
}

export type FullAnalysisRequest = {
  video_path: string;
  chat_path: string;
  overlap_window?: number;
  clip_buffer?: number;
  audio_weight?: number;
  chat_weight?: number;
  audio_threshold_multiplier?: number;
  chat_threshold?: number;
  include_speech?: boolean;
  speech_model_size?: string;
  speech_language?: string;
  speech_keyword_weight?: number;
  speech_rate_weight?: number;
};

export async function runFullAnalysis(
  request: FullAnalysisRequest
): Promise<FullAnalysisResponse> {
  return apiRequest("/api/analyze/full", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export type AnalysisProgress = {
  stage: string;
  percent: number;
  message: string;
};

export async function runFullAnalysisWithProgress(
  request: FullAnalysisRequest,
  onProgress: (progress: AnalysisProgress) => void
): Promise<FullAnalysisResponse> {
  const response = await fetch(`${API_BASE}/api/analyze/full/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw { status: response.status, message: "Request failed" } as ApiError;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw { status: 500, message: "No response body" } as ApiError;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let eventType = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7);
      } else if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        if (eventType === "progress") {
          onProgress({
            stage: data.stage,
            percent: data.percent,
            message: data.message,
          });
        } else if (eventType === "complete") {
          return data as FullAnalysisResponse;
        } else if (eventType === "error") {
          throw { status: 500, message: data.error } as ApiError;
        }
      }
    }
  }

  throw { status: 500, message: "Stream ended without completion" } as ApiError;
}

// Get video URL for playback
export function getVideoUrl(vodPath: string): string {
  return `${API_BASE}/data/${vodPath}`;
}

// Export a clip using FFmpeg
export async function exportClip(
  request: ClipExportRequest
): Promise<ClipExportResponse> {
  return apiRequest("/api/clips/export", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// Get URL for exported clip
export function getClipUrl(clipPath: string): string {
  return `${API_BASE}/data/${clipPath}`;
}

// TTS API
export async function previewTTS(request: TTSPreviewRequest): Promise<Blob> {
  const response = await fetch(`${API_BASE}/api/tts/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw {
      status: response.status,
      message: error.detail || "TTS preview failed",
    } as ApiError;
  }

  return response.blob();
}

export async function generateTTS(
  request: TTSGenerateRequest
): Promise<TTSGenerateResponse> {
  return apiRequest("/api/tts/generate", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function getAudioUrl(audioPath: string): string {
  return `${API_BASE}/data/${audioPath}`;
}

// Avatar API
export async function getAvatars(): Promise<AvatarListResponse> {
  return apiRequest("/api/avatars");
}

// Profile API
export async function listProfiles(): Promise<Profile[]> {
  return apiRequest("/api/profiles");
}

export async function getProfile(id: string): Promise<Profile> {
  return apiRequest(`/api/profiles/${id}`);
}

export async function createProfile(
  data: ProfileCreateRequest
): Promise<Profile> {
  return apiRequest("/api/profiles", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateProfile(
  id: string,
  data: ProfileUpdateRequest
): Promise<Profile> {
  return apiRequest(`/api/profiles/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteProfile(id: string): Promise<void> {
  return apiRequest(`/api/profiles/${id}`, {
    method: "DELETE",
  });
}

// Twitch VOD API
export async function listTwitchVods(): Promise<VodListResponse> {
  return apiRequest("/api/twitch/vods");
}

export async function refreshTwitchVods(): Promise<VodListResponse> {
  return apiRequest("/api/twitch/vods/refresh", {
    method: "POST",
  });
}

export async function downloadVodWithProgress(
  vodId: string,
  onProgress: (progress: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/twitch/vods/${vodId}/download`, {
    method: "POST",
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw { status: response.status, message: error.detail || "Download failed" } as ApiError;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw { status: 500, message: "No response body" } as ApiError;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      let eventType = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7);
        } else if (line.startsWith("data: ")) {
          const data = JSON.parse(line.slice(6));
          if (eventType === "progress") {
            onProgress({
              stage: data.stage,
              percent: data.percent,
              message: data.message,
            });
          } else if (eventType === "complete") {
            return;
          } else if (eventType === "error") {
            throw { status: 500, message: data.error } as ApiError;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function cancelVodDownload(vodId: string): Promise<void> {
  await apiRequest(`/api/twitch/vods/${vodId}/cancel`, {
    method: "POST",
  });
}

export async function deleteVod(vodId: string): Promise<void> {
  await apiRequest(`/api/twitch/vods/${vodId}`, {
    method: "DELETE",
  });
}

export async function getActiveDownloads(): Promise<ActiveDownloadsResponse> {
  return apiRequest("/api/twitch/downloads/active");
}

// Downloaded VODs API
export type DownloadedVodsResponse = {
  vods: TwitchVod[];
};

export async function listDownloadedVods(): Promise<DownloadedVodsResponse> {
  return apiRequest("/api/vods/downloaded");
}

export async function getVodDetail(vodId: string): Promise<TwitchVod> {
  return apiRequest(`/api/vods/${vodId}`);
}

export type VodAnalyzeRequest = {
  overlap_window?: number;
  clip_buffer?: number;
  audio_weight?: number;
  chat_weight?: number;
  audio_threshold_multiplier?: number;
  chat_threshold?: number;
  audio_intensity_cap?: number;
  synergy_bonus?: number;
  min_score?: number;
  include_speech?: boolean;
  speech_model_size?: string;
  speech_language?: string;
  speech_keyword_weight?: number;
  speech_rate_weight?: number;
};

export async function analyzeVodById(
  vodId: string,
  request: VodAnalyzeRequest = {}
): Promise<FullAnalysisResponse> {
  return apiRequest(`/api/vods/${vodId}/analyze`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}
