"use client";

import { Select, type SelectOption } from "./ui";

interface FileSelectorProps {
  vodFiles: string[];
  chatFiles: string[];
  selectedVod: string;
  selectedChat: string;
  onVodChange: (filename: string) => void;
  onChatChange: (filename: string) => void;
  disabled?: boolean;
}

export function FileSelector({
  vodFiles,
  chatFiles,
  selectedVod,
  selectedChat,
  onVodChange,
  onChatChange,
  disabled,
}: FileSelectorProps) {
  const vodOptions: SelectOption[] = vodFiles.map((file) => ({
    value: file,
    label: file,
  }));

  const chatOptions: SelectOption[] = chatFiles.map((file) => ({
    value: file,
    label: file,
  }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label className="block text-sm font-medium text-zinc-400 mb-2">
          VOD File
        </label>
        <Select
          options={vodOptions}
          value={selectedVod}
          onChange={onVodChange}
          placeholder="Select a VOD file..."
          disabled={disabled || vodFiles.length === 0}
        />
        {vodFiles.length === 0 && (
          <p className="mt-1 text-xs text-zinc-500">
            No VOD files found in data/vods/
          </p>
        )}
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-400 mb-2">
          Chat Log
        </label>
        <Select
          options={chatOptions}
          value={selectedChat}
          onChange={onChatChange}
          placeholder="Select a chat file..."
          disabled={disabled || chatFiles.length === 0}
        />
        {chatFiles.length === 0 && (
          <p className="mt-1 text-xs text-zinc-500">
            No chat files found in data/chats/
          </p>
        )}
      </div>
    </div>
  );
}
