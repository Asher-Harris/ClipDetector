"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, Spinner } from "@/components/ui";
import { VodCard } from "@/components/VodCard";
import { listTwitchVods, refreshTwitchVods, type ApiError } from "@/lib/api";
import { useToast } from "@/context/ToastContext";
import type { TwitchVod, TwitchChannel } from "@/lib/types";

export default function VodsPage() {
  const { addToast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
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

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const data = await refreshTwitchVods();
      setChannels(data.channels);
      setVods(data.vods);

      if (data.errors && data.errors.length > 0) {
        const failedChannels = data.errors.map((e) => e.channel).join(", ");
        addToast("error", `Failed to fetch: ${failedChannels}`);
      } else {
        addToast("success", `Loaded ${data.vods.length} VODs`);
      }
    } catch (err) {
      const apiError = err as ApiError;
      addToast("error", apiError.message || "Failed to refresh VODs");
    } finally {
      setIsRefreshing(false);
    }
  };

  const filteredVods = selectedChannel
    ? vods.filter((v) => v.channel_login === selectedChannel)
    : vods;

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-8">
      <main className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-4 mb-2">
              <Link
                href="/"
                className="text-zinc-400 hover:text-white transition-colors"
              >
                &larr; Back
              </Link>
              <h1 className="text-3xl font-bold">Twitch VODs</h1>
            </div>
            <p className="text-zinc-400">
              Browse and download VODs from configured channels
            </p>
          </div>
          <Button onClick={handleRefresh} loading={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </Button>
        </div>

        {channels.length > 0 && (
          <div className="flex items-center gap-2 mb-6">
            <Button
              variant={selectedChannel === null ? "primary" : "secondary"}
              size="sm"
              onClick={() => setSelectedChannel(null)}
            >
              All
            </Button>
            {channels.map((channel) => (
              <Button
                key={channel.login}
                variant={selectedChannel === channel.login ? "primary" : "secondary"}
                size="sm"
                onClick={() => setSelectedChannel(channel.login)}
              >
                {channel.display_name}
              </Button>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : vods.length === 0 ? (
          <Card className="p-8 text-center">
            <h3 className="font-semibold mb-2">No VODs Found</h3>
            <p className="text-zinc-400 text-sm mb-4">
              Click Refresh to fetch VODs from Twitch
            </p>
            <Button onClick={handleRefresh} loading={isRefreshing}>
              Refresh VODs
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredVods.map((vod) => (
              <VodCard key={vod.id} vod={vod} onDownloadComplete={loadVods} onDelete={loadVods} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
