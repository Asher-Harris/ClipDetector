"use client";

import { useEffect, useState } from "react";
import { AppHeader, Spinner } from "@/components/ui";
import { VodCard } from "@/components/VodCard";
import { listTwitchVods, type ApiError } from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import { useApp } from "@/context/AppContext";
import type { TwitchVod, TwitchChannel } from "@/lib/types";

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25H7.5a.75.75 0 0 1-.53-.22L5.19 2.5H1.75z" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  );
}

export default function VodsPage() {
  const { addToast } = useToast();
  const { analysisResult } = useApp();
  const [isLoading, setIsLoading] = useState(true);
  const [channels, setChannels] = useState<TwitchChannel[]>([]);
  const [vods, setVods] = useState<TwitchVod[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

  const loadVods = async () => {
    try {
      const data = await listTwitchVods();
      setChannels(data.channels);
      setVods(data.vods);
    } catch (err) {
      const apiError = err as ApiError;
      addToast("error", apiError.message || "Failed to load VODs");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadVods();
  }, []);

  const filteredVods = selectedChannel
    ? vods.filter((v) => v.channel_login === selectedChannel)
    : vods;

  const downloadedCount = vods.filter((v) => v.downloaded).length;

  return (
    <div className="min-h-screen bg-bg-base">
      <AppHeader currentPage="vods" showReviewLink={!!analysisResult} />

      <main className="max-w-[1800px] mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSelectedChannel(null)}
              className={`px-3 h-7 text-xs font-medium rounded-md transition-colors ${
                selectedChannel === null
                  ? "bg-accent text-white"
                  : "bg-bg-surface hover:bg-bg-hover text-fg-secondary hover:text-fg-default border border-border-default"
              }`}
            >
              All
              <span className="ml-1.5 text-[10px] opacity-70">{vods.length}</span>
            </button>
            {channels.map((channel) => {
              const count = vods.filter((v) => v.channel_login === channel.login).length;
              return (
                <button
                  key={channel.login}
                  onClick={() => setSelectedChannel(channel.login)}
                  className={`px-3 h-7 text-xs font-medium rounded-md transition-colors ${
                    selectedChannel === channel.login
                      ? "bg-accent text-white"
                      : "bg-bg-surface hover:bg-bg-hover text-fg-secondary hover:text-fg-default border border-border-default"
                  }`}
                >
                  {channel.display_name}
                  <span className="ml-1.5 text-[10px] opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
          {vods.length > 0 && (
            <div className="text-xs text-fg-muted tabular-nums">
              {downloadedCount} of {vods.length} downloaded
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Spinner size="lg" />
          </div>
        ) : vods.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-12 h-12 rounded-xl bg-bg-surface border border-border-default flex items-center justify-center mb-4">
              <FolderIcon className="w-6 h-6 text-fg-muted" />
            </div>
            <h3 className="text-sm font-medium text-fg-default mb-1">No VODs found</h3>
            <p className="text-xs text-fg-muted max-w-xs">
              Configure your Twitch channels in config.json and refresh the page
            </p>
          </div>
        ) : filteredVods.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-sm text-fg-muted">No VODs from this channel</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {filteredVods.map((vod) => (
              <VodCard key={vod.id} vod={vod} onDownloadComplete={loadVods} onDelete={loadVods} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
