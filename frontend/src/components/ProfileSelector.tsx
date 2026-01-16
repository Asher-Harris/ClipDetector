"use client";

import { Select, Button, type SelectOption } from "./ui";
import type { Profile } from "@/lib/types";

interface ProfileSelectorProps {
  profiles: Profile[];
  selectedProfileId: string;
  onSelect: (profileId: string) => void;
  onEdit: (profile: Profile) => void;
  onCreate: () => void;
  onDelete: (profile: Profile) => void;
  disabled?: boolean;
}

export function ProfileSelector({
  profiles,
  selectedProfileId,
  onSelect,
  onEdit,
  onCreate,
  onDelete,
  disabled,
}: ProfileSelectorProps) {
  const options: SelectOption[] = profiles.map((p) => ({
    value: p.id,
    label: p.name + (p.is_default ? " (Default)" : ""),
  }));

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);
  const canDelete = selectedProfile && !selectedProfile.is_default;

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <label className="block text-sm font-medium text-zinc-400 mb-2">
          Analysis Profile
        </label>
        <Select
          options={options}
          value={selectedProfileId}
          onChange={onSelect}
          disabled={disabled || profiles.length === 0}
          placeholder="Select a profile..."
        />
      </div>
      <Button
        variant="ghost"
        size="md"
        onClick={() => selectedProfile && onEdit(selectedProfile)}
        disabled={disabled || !selectedProfile}
        title="Edit profile"
      >
        Edit
      </Button>
      <Button
        variant="ghost"
        size="md"
        onClick={onCreate}
        disabled={disabled}
        title="Create new profile"
      >
        New
      </Button>
      <Button
        variant="ghost"
        size="md"
        onClick={() => selectedProfile && onDelete(selectedProfile)}
        disabled={disabled || !canDelete}
        title={canDelete ? "Delete profile" : "Cannot delete default profile"}
      >
        Delete
      </Button>
    </div>
  );
}
