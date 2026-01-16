"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Spinner } from "@/components/ui";
import { FileSelector } from "@/components/FileSelector";
import { listFiles, runFullAnalysis, checkHealth } from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import { useApp } from "@/context/AppContext";

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

  // Check health and load files on mount
  useEffect(() => {
    async function init() {
      try {
        await checkHealth();
        setIsHealthy(true);
        const files = await listFiles();
        setVodFiles(files.vods);
        setChatFiles(files.chats);
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

    setIsAnalyzing(true);
    try {
      const result = await runFullAnalysis({
        video_path: `vods/${selectedVod}`,
        chat_path: `chats/${selectedChat}`,
      });

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
          <p className="mt-4 text-zinc-400 text-sm">
            This may take a few minutes depending on the VOD length...
          </p>
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
    </div>
  );
}
