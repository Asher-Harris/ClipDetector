"use client";

import { useState, useEffect } from "react";
import { Button, Card } from "./ui";
import type { Profile, ProfileCreateRequest } from "@/lib/types";
import { DEFAULT_PROFILE_VALUES, PROFILE_PARAMS } from "@/lib/types";

interface ProfileEditorProps {
  profile: Profile | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: ProfileCreateRequest) => Promise<void>;
  isSaving: boolean;
}

export function ProfileEditor({
  profile,
  isOpen,
  onClose,
  onSave,
  isSaving,
}: ProfileEditorProps) {
  const [formData, setFormData] = useState<ProfileCreateRequest>(
    DEFAULT_PROFILE_VALUES
  );

  useEffect(() => {
    if (profile) {
      setFormData({
        name: profile.name,
        audio_weight: profile.audio_weight,
        chat_weight: profile.chat_weight,
        audio_threshold_multiplier: profile.audio_threshold_multiplier,
        chat_threshold: profile.chat_threshold,
      });
    } else {
      setFormData(DEFAULT_PROFILE_VALUES);
    }
  }, [profile, isOpen]);

  if (!isOpen) return null;

  const handleChange = (
    key: keyof ProfileCreateRequest,
    value: string | number
  ) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave(formData);
  };

  const isEditMode = profile !== null;
  const title = isEditMode ? `Edit Profile: ${profile.name}` : "Create Profile";

  const weightParams = Object.entries(PROFILE_PARAMS).filter(
    ([, p]) => p.category === "weights"
  );
  const thresholdParams = Object.entries(PROFILE_PARAMS).filter(
    ([, p]) => p.category === "thresholds"
  );

  return (
    <div className="fixed inset-0 bg-overlay-bg flex items-center justify-center z-50 animate-fade-in">
      <Card className="w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto animate-scale-in">
        <h2 className="text-xl font-semibold mb-4 text-fg-default">{title}</h2>

        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <label className="block text-sm font-medium text-fg-secondary mb-2">
              Profile Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleChange("name", e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-bg-surface text-fg-default border border-border-default focus:outline-none focus:ring-2 focus:ring-focus-ring"
              placeholder="Enter profile name..."
              disabled={profile?.is_default}
              required
            />
          </div>

          <div className="mb-6">
            <h3 className="text-sm font-semibold text-fg-secondary mb-3">
              Signal Weights
            </h3>
            <div className="space-y-4">
              {weightParams.map(([key, param]) => (
                <div key={key}>
                  <div className="flex justify-between mb-1">
                    <label className="text-sm text-fg-secondary">{param.label}</label>
                    <span className="text-sm text-fg-muted">
                      {formData[key as keyof ProfileCreateRequest]}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    value={formData[key as keyof ProfileCreateRequest] as number}
                    onChange={(e) =>
                      handleChange(
                        key as keyof ProfileCreateRequest,
                        parseFloat(e.target.value)
                      )
                    }
                    className="w-full accent-accent"
                  />
                  <p className="text-xs text-fg-muted mt-1">{param.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-sm font-semibold text-fg-secondary mb-3">
              Detector Thresholds
            </h3>
            <div className="space-y-4">
              {thresholdParams.map(([key, param]) => (
                <div key={key}>
                  <div className="flex justify-between mb-1">
                    <label className="text-sm text-fg-secondary">{param.label}</label>
                    <span className="text-sm text-fg-muted">
                      {formData[key as keyof ProfileCreateRequest]}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    value={formData[key as keyof ProfileCreateRequest] as number}
                    onChange={(e) =>
                      handleChange(
                        key as keyof ProfileCreateRequest,
                        parseFloat(e.target.value)
                      )
                    }
                    className="w-full accent-accent"
                  />
                  <p className="text-xs text-fg-muted mt-1">{param.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              type="button"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isSaving}>
              {isEditMode ? "Save Changes" : "Create Profile"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
