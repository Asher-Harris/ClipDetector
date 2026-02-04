import { type SignalType, SIGNAL_LABELS } from "@/lib/types";

interface BadgeProps {
  signal: SignalType;
  count?: number;
}

const SIGNAL_ICONS: Record<SignalType, React.ReactNode> = {
  audio: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 2v20M8 6v12M4 9v6M16 6v12M20 9v6" strokeLinecap="round"/>
    </svg>
  ),
  chat: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  speech_keyword: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  speech_rate: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  clip_popular: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M7 2v4M17 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M10 14l2-2 2 2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  clip_density: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
};

export function Badge({ signal, count }: BadgeProps) {
  const label = SIGNAL_LABELS[signal] || signal;
  const icon = SIGNAL_ICONS[signal];

  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-hover text-fg-secondary">
      {icon}
      {label}{count && count > 1 ? ` ×${count}` : ""}
    </span>
  );
}
