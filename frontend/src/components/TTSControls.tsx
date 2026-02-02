"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Button, Select } from "./ui";
import { previewTTS, getAvatars, type ApiError } from "@/lib/api";
import {
  type TTSSettings,
  type TTSVoice,
  TTS_VOICES,
  DEFAULT_TTS,
} from "@/lib/types";

interface TTSControlsProps {
  settings: TTSSettings | undefined;
  onChange: (settings: TTSSettings) => void;
  disabled?: boolean;
}

export function TTSControls({ settings, onChange, disabled }: TTSControlsProps) {
  const currentSettings = settings || DEFAULT_TTS;
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avatars, setAvatars] = useState<string[]>([]);
  const [isLoadingAvatars, setIsLoadingAvatars] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (previewUrl && audioRef.current) {
      audioRef.current.load();
      audioRef.current.play().catch(() => {});
    }
  }, [previewUrl]);

  useEffect(() => {
    async function fetchAvatars() {
      try {
        const response = await getAvatars();
        setAvatars(response.avatars);
      } catch {
        // Silently fail - avatar selection unavailable
      } finally {
        setIsLoadingAvatars(false);
      }
    }
    fetchAvatars();
  }, []);

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange({ ...currentSettings, text: e.target.value });
      setPreviewUrl(null);
      setError(null);
    },
    [currentSettings, onChange]
  );

  const handleVoiceChange = useCallback(
    (value: string) => {
      onChange({ ...currentSettings, voice: value as TTSVoice });
      setPreviewUrl(null);
    },
    [currentSettings, onChange]
  );

  const handleSpeedChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ ...currentSettings, speed: parseFloat(e.target.value) });
      setPreviewUrl(null);
    },
    [currentSettings, onChange]
  );

  const handleAvatarChange = useCallback(
    (value: string) => {
      onChange({
        ...currentSettings,
        avatar: value === "" ? undefined : value,
      });
      setPreviewUrl(null);
    },
    [currentSettings, onChange]
  );

  const handlePreview = useCallback(async () => {
    if (!currentSettings.text.trim()) return;

    setIsGenerating(true);
    setError(null);

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }

    try {
      const blob = await previewTTS({
        text: currentSettings.text,
        voice: currentSettings.voice,
        speed: currentSettings.speed,
      });
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message || "Failed to generate preview");
    } finally {
      setIsGenerating(false);
    }
  }, [currentSettings, previewUrl]);

  const handleClear = useCallback(() => {
    onChange(DEFAULT_TTS);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setError(null);
  }, [onChange, previewUrl]);

  const hasText = currentSettings.text.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-fg-secondary">Intro Voice-over</h3>
        {hasText && (
          <button
            onClick={handleClear}
            className="text-xs text-fg-muted hover:text-fg-secondary"
            disabled={disabled}
          >
            Clear
          </button>
        )}
      </div>

      <textarea
        value={currentSettings.text}
        onChange={handleTextChange}
        placeholder="Enter intro text (e.g., 'Check out this amazing play!')"
        disabled={disabled}
        className="w-full px-3 py-2 rounded-lg bg-bg-surface text-fg-default border border-border-default
                   focus:outline-none focus:ring-2 focus:ring-focus-ring focus:border-transparent
                   disabled:opacity-50 resize-none text-sm placeholder-fg-muted"
        rows={2}
        maxLength={500}
      />

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs text-fg-muted mb-1">Voice</label>
          <Select
            options={TTS_VOICES}
            value={currentSettings.voice}
            onChange={handleVoiceChange}
            disabled={disabled}
          />
        </div>
        {avatars.length > 0 && (
          <div className="flex-1">
            <label className="block text-xs text-fg-muted mb-1">Avatar</label>
            <Select
              options={[
                { value: "", label: "None (audio only)" },
                ...avatars.map((avatar) => ({
                  value: avatar,
                  label: avatar.charAt(0).toUpperCase() + avatar.slice(1),
                })),
              ]}
              value={currentSettings.avatar || ""}
              onChange={handleAvatarChange}
              disabled={disabled || isLoadingAvatars}
            />
          </div>
        )}
        <div className="w-32">
          <label className="block text-xs text-fg-muted mb-1">
            Speed: {currentSettings.speed.toFixed(1)}x
          </label>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={currentSettings.speed}
            onChange={handleSpeedChange}
            disabled={disabled}
            className="w-full h-10 accent-accent cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={handlePreview}
          disabled={disabled || isGenerating || !hasText}
          loading={isGenerating}
        >
          {isGenerating ? "Generating..." : "Preview"}
        </Button>

        {previewUrl && (
          <audio
            ref={audioRef}
            src={previewUrl}
            controls
            className="h-8 flex-1"
            style={{ colorScheme: "dark" }}
          />
        )}
      </div>

      {error && <p className="text-xs text-error">{error}</p>}

      {hasText && (
        <p className="text-xs text-fg-muted">
          {currentSettings.text.length}/500 characters
        </p>
      )}
    </div>
  );
}
