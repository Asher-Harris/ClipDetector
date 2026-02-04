"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppHeader, Button, Select, Spinner } from "@/components/ui";
import { ProfileEditor } from "@/components/ProfileEditor";
import { VodSelector } from "@/components/VodSelector";
import {
  listDownloadedVods,
  analyzeVodById,
  checkHealth,
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  getConfig,
  type AnalysisProgress,
  type AppConfig,
} from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import { useApp } from "@/context/AppContext";
import type { Profile, ProfileCreateRequest, SelectOption, TwitchVod } from "@/lib/types";

export default function Home() {
  const router = useRouter();
  const { addToast } = useToast();
  const { setAnalysisResult, analysisResult } = useApp();

  const [isHealthy, setIsHealthy] = useState<boolean | null>(null);
  const [downloadedVods, setDownloadedVods] = useState<TwitchVod[]>([]);
  const [selectedVodId, setSelectedVodId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("default");
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [includeSpeech, setIncludeSpeech] = useState(false);
  const [speechModelSize, setSpeechModelSize] = useState("base");
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);

  const selectedVod = useMemo(
    () => downloadedVods.find((v) => v.id === selectedVodId),
    [downloadedVods, selectedVodId]
  );

  useEffect(() => {
    async function init() {
      try {
        await checkHealth();
        setIsHealthy(true);
        const [vodsResponse, profileList, appConfig] = await Promise.all([
          listDownloadedVods(),
          listProfiles(),
          getConfig(),
        ]);
        setDownloadedVods(vodsResponse.vods);
        setProfiles(profileList);
        setConfig(appConfig);
      } catch {
        setIsHealthy(false);
        addToast("error", "Failed to connect to backend");
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, [addToast]);

  const handleAnalyze = async () => {
    if (!selectedVodId || !selectedVod) return;

    const profile = profiles.find((p) => p.id === selectedProfileId);
    const speechEnabled = includeSpeech && config?.features.speech_analysis;

    setIsAnalyzing(true);
    setAnalysisProgress(null);

    const requestParams = {
      audio_weight: profile?.audio_weight,
      chat_weight: profile?.chat_weight,
      audio_threshold_multiplier: profile?.audio_threshold_multiplier,
      chat_threshold: profile?.chat_threshold,
      include_speech: speechEnabled,
      speech_model_size: speechEnabled ? speechModelSize : undefined,
      speech_keyword_weight: profile?.speech_keyword_weight,
      speech_rate_weight: profile?.speech_rate_weight,
      clip_popular_weight: profile?.clip_popular_weight,
      clip_density_weight: profile?.clip_density_weight,
    };

    try {
      const result = await analyzeVodById(selectedVodId, requestParams);

      setAnalysisResult({
        videoPath: result.video_path,
        chatPath: result.chat_path,
        candidates: result.candidates,
        analyzedAt: new Date().toISOString(),
        vodId: selectedVodId,
        vodTitle: selectedVod.title,
        channelLogin: selectedVod.channel_login,
      });

      addToast("success", `Found ${result.total_candidates} clip candidates`);
      router.push("/review");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analysis failed";
      addToast("error", message);
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress(null);
    }
  };

  const handleEditProfile = (profile: Profile) => {
    setEditingProfile(profile);
    setIsEditorOpen(true);
  };

  const handleCreateProfile = () => {
    setEditingProfile(null);
    setIsEditorOpen(true);
  };

  const handleDeleteProfile = async (profile: Profile) => {
    if (profile.is_default) return;
    try {
      await deleteProfile(profile.id);
      setProfiles((prev) => prev.filter((p) => p.id !== profile.id));
      if (selectedProfileId === profile.id) {
        setSelectedProfileId("default");
      }
      addToast("success", "Profile deleted");
    } catch {
      addToast("error", "Failed to delete profile");
    }
  };

  const handleSaveProfile = async (data: ProfileCreateRequest) => {
    setIsSavingProfile(true);
    try {
      if (editingProfile) {
        const updated = await updateProfile(editingProfile.id, data);
        setProfiles((prev) =>
          prev.map((p) => (p.id === updated.id ? updated : p))
        );
        addToast("success", "Profile updated");
      } else {
        const created = await createProfile(data);
        setProfiles((prev) => [...prev, created]);
        setSelectedProfileId(created.id);
        addToast("success", "Profile created");
      }
      setIsEditorOpen(false);
    } catch {
      addToast("error", "Failed to save profile");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const canAnalyze = selectedVodId && !isAnalyzing && isHealthy;
  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);

  const profileOptions: SelectOption[] = profiles.map((p) => ({
    value: p.id,
    label: p.name + (p.is_default ? " (Default)" : ""),
  }));

  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg-base text-fg-default">
        <AppHeader currentPage="analyze" showReviewLink={!!analysisResult} />
        <main className="max-w-2xl mx-auto px-6 py-16">
          <div className="flex flex-col items-center justify-center gap-4">
            <Spinner size="lg" />
            <p className="text-fg-muted text-sm">Loading...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!isHealthy) {
    return (
      <div className="min-h-screen bg-bg-base text-fg-default">
        <AppHeader currentPage="analyze" showReviewLink={!!analysisResult} />
        <main className="max-w-2xl mx-auto px-6 py-16">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-error-muted mb-4">
              <span className="w-3 h-3 rounded-full bg-error" />
            </div>
            <h2 className="text-lg font-medium mb-2">Backend Unavailable</h2>
            <p className="text-fg-secondary text-sm mb-6">
              Make sure the backend server is running on port 8000.
            </p>
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Retry Connection
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const hasNoVods = downloadedVods.length === 0;

  if (hasNoVods) {
    return (
      <div className="min-h-screen bg-bg-base text-fg-default">
        <AppHeader currentPage="analyze" showReviewLink={!!analysisResult} />
        <main className="max-w-2xl mx-auto px-6 py-16">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-bg-surface border border-border-default mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-fg-muted">
                <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h2 className="text-lg font-medium mb-2">No Downloaded VODs</h2>
            <p className="text-fg-secondary text-sm mb-6">
              Download VODs from Twitch to start analyzing for clip-worthy moments.
            </p>
            <Link href="/vods">
              <Button>Go to VODs Page</Button>
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-base text-fg-default">
      <AppHeader currentPage="analyze" showReviewLink={!!analysisResult} />

      <main className="max-w-2xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-xl font-semibold mb-1">New Analysis</h1>
          <p className="text-fg-muted text-sm">
            Select files to analyze for clip-worthy moments
          </p>
        </div>

        <div className="bg-bg-surface border border-border-default rounded-lg divide-y divide-border-default">
          {/* VOD Selection */}
          <div className="p-4">
            <label className="block text-xs font-medium text-fg-muted mb-3 uppercase tracking-wide">
              Select VOD
            </label>
            <VodSelector
              vods={downloadedVods}
              selectedVodId={selectedVodId}
              onSelect={setSelectedVodId}
              disabled={isAnalyzing}
            />
          </div>

          {/* Profile Selection */}
          <div className="p-4">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-fg-muted mb-1.5 uppercase tracking-wide">
                  Analysis Profile
                </label>
                <Select
                  options={profileOptions}
                  value={selectedProfileId}
                  onChange={setSelectedProfileId}
                  disabled={isAnalyzing || profiles.length === 0}
                  placeholder="Select profile..."
                />
              </div>
              <button
                onClick={() => selectedProfile && handleEditProfile(selectedProfile)}
                disabled={isAnalyzing || !selectedProfile}
                className="px-3 py-2 text-sm text-fg-muted hover:text-fg-default disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Edit
              </button>
              <button
                onClick={handleCreateProfile}
                disabled={isAnalyzing}
                className="px-3 py-2 text-sm text-fg-muted hover:text-fg-default disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                New
              </button>
              {selectedProfile && !selectedProfile.is_default && (
                <button
                  onClick={() => handleDeleteProfile(selectedProfile)}
                  disabled={isAnalyzing}
                  className="px-3 py-2 text-sm text-fg-muted hover:text-error disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Delete
                </button>
              )}
            </div>
          </div>

          {/* Speech Analysis (if enabled) */}
          {config?.features.speech_analysis && (
            <div className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setIncludeSpeech(!includeSpeech)}
                    disabled={isAnalyzing}
                    className={`
                      relative w-9 h-5 rounded-full transition-colors
                      ${includeSpeech ? "bg-accent" : "bg-bg-overlay"}
                      disabled:opacity-50 disabled:cursor-not-allowed
                    `}
                  >
                    <span
                      className={`
                        absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform
                        ${includeSpeech ? "translate-x-4" : "translate-x-0"}
                      `}
                    />
                  </button>
                  <div>
                    <p className="text-sm font-medium">Speech Analysis</p>
                    <p className="text-xs text-fg-muted">Transcribe audio for keyword detection</p>
                  </div>
                </div>
                {includeSpeech && (
                  <Select
                    value={speechModelSize}
                    onChange={setSpeechModelSize}
                    options={[
                      { value: "tiny", label: "Tiny" },
                      { value: "base", label: "Base" },
                      { value: "small", label: "Small" },
                      { value: "medium", label: "Medium" },
                    ]}
                    disabled={isAnalyzing}
                    className="w-28"
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Analysis Progress */}
        {isAnalyzing && (
          <div className="mt-6 bg-bg-surface border border-border-default rounded-lg p-4">
            <div className="flex items-center gap-3 mb-3">
              <Spinner size="sm" />
              <span className="text-sm font-medium">
                {analysisProgress?.message || "Starting analysis..."}
              </span>
            </div>
            {analysisProgress && (
              <div className="space-y-1.5">
                <div className="w-full h-1.5 bg-bg-overlay rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all duration-300"
                    style={{ width: `${analysisProgress.percent}%` }}
                  />
                </div>
                <p className="text-xs text-fg-muted text-right font-mono">
                  {analysisProgress.percent}%
                </p>
              </div>
            )}
          </div>
        )}

        {/* Submit Button */}
        <div className="mt-6">
          <Button
            size="lg"
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            loading={isAnalyzing}
            className="w-full"
          >
            {isAnalyzing ? "Analyzing..." : "Run Analysis"}
          </Button>
          {!selectedVodId && (
            <p className="text-xs text-fg-muted text-center mt-2">
              Select a VOD to continue
            </p>
          )}
        </div>
      </main>

      <ProfileEditor
        profile={editingProfile}
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        onSave={handleSaveProfile}
        isSaving={isSavingProfile}
      />
    </div>
  );
}
