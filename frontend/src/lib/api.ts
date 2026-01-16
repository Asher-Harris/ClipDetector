import type { FileListResponse, FullAnalysisResponse } from "./types";

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

export async function listFiles(): Promise<FileListResponse> {
  return apiRequest("/api/files");
}

export type FullAnalysisRequest = {
  video_path: string;
  chat_path: string;
  overlap_window?: number;
  clip_buffer?: number;
};

export async function runFullAnalysis(
  request: FullAnalysisRequest
): Promise<FullAnalysisResponse> {
  return apiRequest("/api/analyze/full", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// Get video URL for playback
export function getVideoUrl(vodPath: string): string {
  return `${API_BASE}/data/${vodPath}`;
}
