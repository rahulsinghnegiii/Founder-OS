import React from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { useVoice } from "@/lib/voice/VoiceProvider";
import { deriveThinkingStatus } from "@/lib/voice/voiceStatus";
import { StreamingText } from "./StreamingText";
import { cn } from "@/lib/utils";

function Equalizer({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-4 items-end gap-[3px]", className)} aria-hidden>
      {[0, 140, 280, 90].map((d, i) => (
        <span key={i} className="eq-bar" style={{ animationDelay: `${d}ms` }} />
      ))}
    </div>
  );
}

function Wave({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-4 items-end gap-[3px]", className)} aria-hidden>
      {[0, 130, 260, 90, 200].map((d, i) => (
        <span key={i} className="wave-bar" style={{ animationDelay: `${d}ms` }} />
      ))}
    </div>
  );
}

/**
 * The inner content of the voice feedback surface. Parent components wrap this
 * in a positioned card. Reads everything from the VoiceProvider context.
 */
export function VoiceBubble({ className, replyOverride }: { className?: string; replyOverride?: string | null }) {
  const voice = useVoice();
  const { state, partial, final, error, lastReply, lastUserMessage } = voice;

  const thinking = deriveThinkingStatus(lastUserMessage);
  const reply = replyOverride ?? lastReply ?? "";

  return (
    <div className={cn("space-y-3", className)}>
      {state === "listening" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-rose-500">
            <Equalizer />
            Listening
          </div>
          <p className="text-[0.95rem] leading-6 text-slate-800">
            {partial ? partial : <span className="text-muted-foreground">I'm listening…</span>}
          </p>
        </div>
      )}

      {state === "thinking" && (
        <div className="space-y-1">
          <p className="text-sm font-semibold text-rose-500">{thinking.ack}</p>
          <p className="flex items-center gap-2 text-[0.95rem] leading-6 text-slate-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
            {thinking.status}
          </p>
        </div>
      )}

      {state === "speaking" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-sky-500">
            <Wave />
            Speaking
          </div>
          <p className="text-[0.95rem] leading-6 text-slate-800">
            <StreamingText text={reply} caret={false} />
          </p>
        </div>
      )}

      {state === "confirm" && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">
            Did I get that right?
          </p>
          <p className="rounded-2xl bg-amber-100/70 px-3 py-2 text-[0.95rem] leading-6 text-slate-800">“{final}”</p>
          <div className="flex gap-2">
            <button
              onClick={voice.confirm}
              className="flex items-center gap-1.5 rounded-full bg-zinc-950 px-3.5 py-1.5 text-xs font-medium text-white shadow-sm transition-transform hover:-translate-y-0.5"
            >
              <Check className="h-3.5 w-3.5" /> Send
            </button>
            <button
              onClick={voice.reject}
              className="flex items-center gap-1.5 rounded-full border border-border bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-transform hover:-translate-y-0.5"
            >
              <X className="h-3.5 w-3.5" /> Discard
            </button>
          </div>
        </div>
      )}

      {state === "error" && (
        <p className="text-[0.95rem] leading-6 text-rose-700">{error}</p>
      )}

      {state === "idle" && (
        <p className="text-[0.95rem] leading-6 text-slate-600">
          Press the microphone or start typing.
        </p>
      )}
    </div>
  );
}
