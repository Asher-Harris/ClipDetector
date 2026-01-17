const STORAGE_KEYS = {
  ANALYSIS_RESULT: "clipdetector_analysis",
  CLIP_STATUSES: "clipdetector_statuses",
  FINALIZED_CLIPS: "clipdetector_finalized",
} as const;

export function loadFromStorage<T>(key: string, defaultValue: T): T {
  if (typeof window === "undefined") return defaultValue;
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
}

export function saveToStorage<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("Failed to save to localStorage:", e);
  }
}

export function clearStorage(key: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(key);
}

export { STORAGE_KEYS };
