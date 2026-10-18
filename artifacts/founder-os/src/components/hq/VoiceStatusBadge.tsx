import React from "react";
import { Volume2, Brain, Mic, MessageSquare } from "lucide-react";
import { useVoice } from "@/lib/voice/VoiceProvider";
import { cn } from "@/lib/utils";

const STATUS: Record<string, { icon: React.ReactNode; label: string; tone: string }> = {
  listening: {
    icon: <Mic className="h-3.5 w-3.5" />,
    label: "Listening",
    tone: "border-rose-300 bg-rose-50 text-rose-600",
  },
  thinking: {
    icon: <Brain className="h-3.5 w-3.5" />,
    label: "Thinking",
    tone: "border-violet-300 bg-violet-50 text-violet-600",
  },
  speaking: {
    icon: <Volume2 className="h-3.5 w-3.5" />,
    label: "Speaking",
    tone: "border-sky-300 bg-sky-50 text-sky-600",
  },
  confirm: {
    icon: <MessageSquare className="h-3.5 w-3.5" />,
    label: "Confirming",
    tone: "border-amber-300 bg-amber-50 text-amber-600",
  },
  error: {
    icon: <MessageSquare className="h-3.5 w-3.5" />,
    label: "Error",
    tone: "border-rose-300 bg-rose-50 text-rose-600",
  },
};

export function VoiceStatusBadge({ className }: { className?: string }) {
  const { state } = useVoice();
  if (state === "idle" || state === "interrupted") return null;
  const s = STATUS[state];
  if (!s) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] animate-in fade-in zoom-in-95 duration-200",
        s.tone,
        className,
      )}
    >
      {s.icon}
      {s.label}
    </span>
  );
}
