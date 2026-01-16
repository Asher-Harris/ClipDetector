import { type SignalType, SIGNAL_LABELS, SIGNAL_COLORS } from "@/lib/types";

interface BadgeProps {
  signal: SignalType;
}

export function Badge({ signal }: BadgeProps) {
  const label = SIGNAL_LABELS[signal] || signal;
  const colorClass = SIGNAL_COLORS[signal] || "bg-zinc-600";

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white ${colorClass}`}
    >
      {label}
    </span>
  );
}
