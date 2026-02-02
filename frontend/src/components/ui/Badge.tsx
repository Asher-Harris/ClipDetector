import { type SignalType, SIGNAL_LABELS, SIGNAL_COLORS } from "@/lib/types";

interface BadgeProps {
  signal: SignalType;
  count?: number;
}

export function Badge({ signal, count }: BadgeProps) {
  const label = SIGNAL_LABELS[signal] || signal;
  const colorClass = SIGNAL_COLORS[signal] || "bg-fg-muted";

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white ${colorClass}`}
    >
      {label}{count && count > 1 ? ` x${count}` : ""}
    </span>
  );
}
