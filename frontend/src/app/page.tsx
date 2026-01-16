"use client";

import { useEffect, useState } from "react";

type HealthStatus = {
  status: string;
  service: string;
} | null;

export default function Home() {
  const [health, setHealth] = useState<HealthStatus>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch("http://localhost:8000/health");
        if (!res.ok) throw new Error("Backend not responding");
        const data = await res.json();
        setHealth(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to connect to backend");
      }
    }
    checkHealth();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-8">
      <main className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-2">ClipDetector</h1>
        <p className="text-zinc-400 mb-8">
          Analyze Twitch VODs to detect clip-worthy moments
        </p>

        <div className="bg-zinc-900 rounded-lg p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Backend Status</h2>
          {error ? (
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500"></span>
              <span className="text-red-400">{error}</span>
            </div>
          ) : health ? (
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-green-500"></span>
              <span className="text-green-400">
                {health.service} - {health.status}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-yellow-500 animate-pulse"></span>
              <span className="text-yellow-400">Checking...</span>
            </div>
          )}
        </div>

        <div className="text-zinc-500 text-sm">
          <p>To get started:</p>
          <ol className="list-decimal list-inside mt-2 space-y-1">
            <li>Start the backend: <code className="bg-zinc-800 px-2 py-1 rounded">cd backend && uvicorn main:app --reload</code></li>
            <li>Place VOD files in <code className="bg-zinc-800 px-2 py-1 rounded">data/vods/</code></li>
            <li>Place chat JSON files in <code className="bg-zinc-800 px-2 py-1 rounded">data/chats/</code></li>
          </ol>
        </div>
      </main>
    </div>
  );
}
