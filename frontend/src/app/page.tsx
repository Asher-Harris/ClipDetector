"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Select, Spinner } from "@/components/ui";
import { FileSelector } from "@/components/FileSelector";
import { ProfileSelector } from "@/components/ProfileSelector";
import { ProfileEditor } from "@/components/ProfileEditor";
import {
  listFiles,
  runFullAnalysis,
  runFullAnalysisWithProgress,
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
import type { Profile, ProfileCreateRequest } from "@/lib/types";

export default function Home() {
  const router = useRouter();
  const { addToast } = useToast();
  const { setAnalysisResult, analysisResult } = useApp();

  const [isHealthy, setIsHealthy] = useState<boolean | null>(null);
  const [vodFiles, setVodFiles] = useState<string[]>([]);
  const [chatFiles, setChatFiles] = useState<string[]>([]);
  const [selectedVod, setSelectedVod] = useState("");
  const [selectedChat, setSelectedChat] = useState("");
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

  // Check health and load files/profiles on mount
  useEffect(() => {
    async function init() {
      try {
        await checkHealth();
        setIsHealthy(true);
        const [files, profileList, appConfig] = await Promise.all([
          listFiles(),
          listProfiles(),
          getConfig(),
        ]);
        setVodFiles(files.vods);
        setChatFiles(files.chats);
        setProfiles(profileList);
        setConfig(appConfig);
      } catch (error) {
        setIsHealthy(false);
        addToast("error", "Failed to connect to backend");
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, [addToast]);

  const handleAnalyze = async () => {
    if (!selectedVod || !selectedChat) return;

    const profile = profiles.find((p) => p.id === selectedProfileId);
    const speechEnabled = includeSpeech && config?.features.speech_analysis;

    setIsAnalyzing(true);
    setAnalysisProgress(null);

    const requestParams = {
      video_path: `vods/${selectedVod}`,
      chat_path: `chats/${selectedChat}`,
      audio_weight: profile?.audio_weight,
      chat_weight: profile?.chat_weight,
      audio_threshold_multiplier: profile?.audio_threshold_multiplier,
      chat_threshold: profile?.chat_threshold,
      include_speech: speechEnabled,
      speech_model_size: speechEnabled ? speechModelSize : undefined,
      speech_keyword_weight: profile?.speech_keyword_weight,
      speech_rate_weight: profile?.speech_rate_weight,
    };

    try {
      let result;
      if (speechEnabled) {
        result = await runFullAnalysisWithProgress(requestParams, setAnalysisProgress);
      } else {
        result = await runFullAnalysis(requestParams);
      }

      setAnalysisResult({
        videoPath: result.video_path,
        chatPath: result.chat_path,
        candidates: result.candidates,
        analyzedAt: new Date().toISOString(),
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

  const canAnalyze = selectedVod && selectedChat && !isAnalyzing;

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-8">
      <main className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-2">ClipDetector</h1>
        <p className="text-zinc-400 mb-8">
          Analyze Twitch VODs to detect clip-worthy moments
        </p>

        {/* Backend Status */}
        <Card className="p-4 mb-6">
          <div className="flex items-center gap-2">
            {isLoading ? (
              <>
                <span className="w-3 h-3 rounded-full bg-yellow-500 animate-pulse" />
                <span className="text-yellow-400">Connecting to backend...</span>
              </>
            ) : isHealthy ? (
              <>
                <span className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-green-400">Backend connected</span>
              </>
            ) : (
              <>
                <span className="w-3 h-3 rounded-full bg-red-500" />
                <span className="text-red-400">Backend not available</span>
              </>
            )}
          </div>
        </Card>

        {/* File Selection */}
        <Card className="p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Select Files</h2>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size="lg" />
            </div>
          ) : (
            <FileSelector
              vodFiles={vodFiles}
              chatFiles={chatFiles}
              selectedVod={selectedVod}
              selectedChat={selectedChat}
              onVodChange={setSelectedVod}
              onChatChange={setSelectedChat}
              disabled={isAnalyzing}
            />
          )}
        </Card>

        {/* Profile Selection */}
        <Card className="p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Analysis Profile</h2>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size="lg" />
            </div>
          ) : (
            <ProfileSelector
              profiles={profiles}
              selectedProfileId={selectedProfileId}
              onSelect={setSelectedProfileId}
              onEdit={handleEditProfile}
              onCreate={handleCreateProfile}
              onDelete={handleDeleteProfile}
              disabled={isAnalyzing}
            />
          )}
        </Card>

        {/* Speech Analysis */}
        {config?.features.speech_analysis && (
          <Card className="p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Speech Analysis</h2>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSpeech}
                  onChange={(e) => setIncludeSpeech(e.target.checked)}
                  disabled={isAnalyzing}
                  className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-zinc-900"
                />
                <span>Enable speech transcription</span>
              </label>
              {includeSpeech && (
                <Select
                  value={speechModelSize}
                  onChange={setSpeechModelSize}
                  options={[
                    { value: "tiny", label: "Tiny (fastest)" },
                    { value: "base", label: "Base (recommended)" },
                    { value: "small", label: "Small (better accuracy)" },
                    { value: "medium", label: "Medium (slow)" },
                  ]}
                  disabled={isAnalyzing}
                  className="w-48"
                />
              )}
            </div>
            {includeSpeech && (
              <p className="mt-3 text-zinc-400 text-sm">
                Transcribes audio to detect excitement phrases and fast speech. Adds significant processing time.
              </p>
            )}
          </Card>
        )}

        {/* Analyze Button */}
        <div className="flex items-center gap-4">
          <Button
            size="lg"
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            loading={isAnalyzing}
          >
            {isAnalyzing ? "Analyzing..." : "Run Analysis"}
          </Button>

          {analysisResult && (
            <Button variant="secondary" size="lg" onClick={() => router.push("/review")}>
              View Previous Results
            </Button>
          )}
        </div>

        {isAnalyzing && (
          <div className="mt-4">
            {analysisProgress ? (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-300">{analysisProgress.message}</span>
                  <span className="text-zinc-400">{analysisProgress.percent}%</span>
                </div>
                <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${analysisProgress.percent}%` }}
                  />
                </div>
              </div>
            ) : (
              <p className="text-zinc-400 text-sm">
                {includeSpeech
                  ? "Starting speech transcription..."
                  : "This may take a few minutes depending on the VOD length..."}
              </p>
            )}
          </div>
        )}

        {/* Instructions */}
        {!isLoading && vodFiles.length === 0 && chatFiles.length === 0 && (
          <Card className="p-6 mt-8">
            <h3 className="font-semibold mb-2">Getting Started</h3>
            <ol className="list-decimal list-inside space-y-2 text-zinc-400 text-sm">
              <li>
                Place VOD files in{" "}
                <code className="bg-zinc-800 px-2 py-1 rounded">data/vods/</code>
              </li>
              <li>
                Place chat JSON files in{" "}
                <code className="bg-zinc-800 px-2 py-1 rounded">data/chats/</code>
              </li>
              <li>Refresh this page to see available files</li>
            </ol>
          </Card>
        )}
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
