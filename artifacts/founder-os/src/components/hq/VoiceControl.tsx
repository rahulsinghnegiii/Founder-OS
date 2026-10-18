import React from "react";
import { AlertTriangle, Loader2, Mic, Volume2, Repeat } from "lucide-react";
import { useVoice } from "@/lib/voice/VoiceProvider";
import { VoiceBubble } from "./VoiceBubble";
import { cn } from "@/lib/utils";

export function VoiceControl({ className }: { className?: string }) {
  const voice = useVoice();
  const { state, lastReply, settings, support } = voice;

  const onMic = () => {
    if (state === "listening") voice.stop();
    else if (state === "confirm") voice.confirm();
    else if (state === "error") voice.start();
    else voice.start(); // idle / thinking / speaking → start (interrupts speech)
  };

  const micBase =
    "relative flex h-14 w-14 items-center justify-center rounded-[1.5rem] border-2 border-border text-zinc-950 shadow-[5px_5px_0px_var(--shadow-ink)] transition-transform active:translate-y-0.5";

  const micState = cn(
    micBase,
    state === "listening" && "voice-listening bg-rose-400",
    state === "thinking" && "bg-violet-300",
    state === "speaking" && "voice-speaking bg-sky-300",
    state === "confirm" && "bg-amber-300",
    state === "error" && "voice-error bg-rose-400",
    state === "idle" && "bg-rose-300 hover:-translate-y-0.5",
  );

  const icon =
    state === "thinking" ? (
      <Loader2 className="h-6 w-6 animate-spin" />
    ) : state === "speaking" ? (
      <Volume2 className="h-6 w-6" />
    ) : state === "error" ? (
      <AlertTriangle className="h-6 w-6" />
    ) : (
      <Mic className="h-6 w-6" />
    );

  const micLabel =
    state === "listening"
      ? "Stop listening"
      : state === "thinking"
        ? "Cancel"
        : state === "speaking"
          ? "Stop speaking"
          : state === "confirm"
            ? "Confirm and send"
            : state === "error"
              ? "Retry voice input"
              : "Talk to your assistant";

  const showBubble = state !== "idle";

  return (
    <div className={cn("relative flex flex-col items-center", className)}>
      {showBubble && (
        <div className="absolute bottom-full left-1/2 mb-3 w-[min(80vw,360px)] -translate-x-1/2 rounded-[1.4rem] border-2 border-border bg-white/95 px-4 py-3 shadow-[5px_5px_0px_var(--shadow-ink)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
          <VoiceBubble />
        </div>
      )}

      <div className="flex items-center gap-2">
        <button onClick={onMic} className={micState} aria-label={micLabel} title={micLabel}>
          {icon}
        </button>

        {state === "idle" && lastReply && settings.ttsMode !== "always" && support.synthesis && (
          <button
            onClick={voice.replayLast}
            aria-label="Replay last reply"
            title="Replay last reply"
            className="flex h-11 w-11 items-center justify-center rounded-[1.2rem] border-2 border-border bg-white text-slate-700 shadow-[3px_3px_0px_var(--shadow-ink)] transition-transform hover:-translate-y-0.5 active:translate-y-0"
          >
            <Repeat className="h-4 w-4" />
          </button>
        )}
      </div>

      {!support.recognition && state === "idle" && (
        <p className="mt-2 max-w-[200px] text-center text-[11px] leading-4 text-muted-foreground">
          Voice needs Chrome or Edge.
        </p>
      )}
    </div>
  );
}
