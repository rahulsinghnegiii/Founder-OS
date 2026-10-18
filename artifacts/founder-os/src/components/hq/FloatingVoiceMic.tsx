import React from "react";
import { useLocation } from "wouter";
import { AlertTriangle, ArrowUpRight, Loader2, Mic, Volume2 } from "lucide-react";
import { useVoice } from "@/lib/voice/VoiceProvider";
import { VoiceBubble } from "./VoiceBubble";
import { cn } from "@/lib/utils";

export function FloatingVoiceMic() {
  const voice = useVoice();
  const [location, setLocation] = useLocation();
  const { state, settings, support } = voice;

  // The EA Desk already has a dedicated mic in its input bar.
  if (location === "/chat") return null;

  const onMic = () => {
    if (state === "listening") voice.stop();
    else if (state === "confirm") voice.confirm();
    else if (state === "error") voice.start();
    else voice.start();
  };

  const micBase =
    "relative flex h-16 w-16 items-center justify-center rounded-[1.7rem] border-2 border-border text-zinc-950 shadow-[6px_6px_0px_var(--shadow-ink)] transition-transform active:translate-y-0.5";

  const micState = cn(
    micBase,
    state === "listening" && "voice-listening bg-rose-400",
    state === "thinking" && "bg-violet-300",
    state === "speaking" && "voice-speaking bg-sky-300",
    state === "confirm" && "bg-amber-300",
    state === "error" && "voice-error bg-rose-400",
    state === "idle" && "voice-glow bg-rose-300 hover:-translate-y-0.5",
  );

  const icon =
    state === "thinking" ? (
      <Loader2 className="h-7 w-7 animate-spin" />
    ) : state === "speaking" ? (
      <Volume2 className="h-7 w-7" />
    ) : state === "error" ? (
      <AlertTriangle className="h-7 w-7" />
    ) : (
      <Mic className="h-7 w-7" />
    );

  const micLabel =
    state === "listening"
      ? "Stop listening"
      : state === "speaking"
        ? "Stop speaking"
        : state === "error"
          ? "Retry voice input"
          : "Talk to your assistant";

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {state !== "idle" && (
        <div className="w-[min(88vw,380px)] rounded-[1.6rem] border-2 border-border bg-white/95 p-4 shadow-[6px_6px_0px_var(--shadow-ink)] backdrop-blur-xl animate-in fade-in slide-in-from-bottom-3 zoom-in-95 duration-200">
          <VoiceBubble />
          <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3">
            <p className="text-[11px] text-muted-foreground">Your assistant remembers everything.</p>
            <button
              onClick={() => setLocation("/chat")}
              className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-600 hover:underline"
            >
              EA Desk <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col items-center gap-1.5">
        <button onClick={onMic} className={micState} aria-label={micLabel} title={micLabel}>
          {icon}
        </button>
        {state === "idle" && support.recognition && (
          <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm backdrop-blur">
            Hold Space to talk
          </span>
        )}
        {!support.recognition && (
          <span className="max-w-[140px] text-center text-[10px] leading-3 text-muted-foreground">
            Voice needs Chrome or Edge
          </span>
        )}
      </div>
    </div>
  );
}
