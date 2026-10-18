import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_VOICE_SETTINGS,
  SPEAKING_RATE,
  type TranscriptResult,
  type VoiceSettings,
  type VoiceState,
  type VoiceSupport,
  type VoiceSender,
} from "./types";
import { createTranscriptionProvider, isSpeechRecognitionSupported } from "./transcription";
import { cancelSpeech, cleanupTranscript, isTTSSupported, speak } from "./tts";
import { usePersistentState } from "@/hooks/use-persistent-state";

/** How long the founder can pause before we treat the utterance as finished. */
const SILENCE_MS = 3000;

const logVoice = (stage: string, extra?: unknown) => {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(`[VOICE] ${stage}`, extra ?? "");
  }
};

interface VoiceContextValue {
  state: VoiceState;
  partial: string;
  final: string;
  confidence: number;
  error: string | null;
  settings: VoiceSettings;
  support: VoiceSupport;
  lastReply: string | null;
  lastUserMessage: string;
  setSettings: (s: VoiceSettings) => void;
  registerSender: (fn: VoiceSender | null) => void;
  start: () => void;
  stop: () => void;
  cancel: () => void;
  confirm: () => void;
  reject: () => void;
  replayLast: () => void;
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

function mapError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was blocked. Enable it in your browser settings.";
    case "audio-capture":
      return "No microphone found. Connect a mic and try again.";
    case "network":
      return "The speech service is offline. Check your connection.";
    case "no-speech":
      return "I didn't catch that — try again.";
    case "unsupported":
      return "Voice isn't supported in this browser. Try Chrome or Edge.";
    default:
      return "Voice input hit a snag. Try again.";
  }
}

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = usePersistentState<VoiceSettings>(
    "founderos:voice-settings",
    DEFAULT_VOICE_SETTINGS,
  );
  const [state, setState] = useState<VoiceState>("idle");
  const [partial, setPartial] = useState("");
  const [final, setFinal] = useState("");
  const [confidence, setConfidence] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastReply, setLastReply] = useState<string | null>(null);
  const [lastUserMessage, setLastUserMessage] = useState("");

  const support = useMemo<VoiceSupport>(
    () => ({ recognition: isSpeechRecognitionSupported(), synthesis: isTTSSupported() }),
    [],
  );

  const senderRef = useRef<VoiceSender | null>(null);
  const providerRef = useRef<ReturnType<typeof createTranscriptionProvider> | null>(null);
  const finalRef = useRef("");
  const confidenceRef = useRef(0);
  const committedRef = useRef(false);
  const cancelledRef = useRef(false);
  const speakingRef = useRef(false);

  // Refs that let the global keyboard handler (and timers) read fresh values
  // without re-binding listeners on every state change.
  const stateRef = useRef<VoiceState>(state);
  stateRef.current = state;

  const silenceTimerRef = useRef<number | null>(null);
  const lastSpeechRef = useRef<number>(0);

  const registerSender = useCallback((fn: VoiceSender | null) => {
    senderRef.current = fn;
  }, []);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  // Restart the end-of-utterance timer. Every time the founder speaks (or a
  // finalized chunk lands) we push the deadline out by SILENCE_MS, so brief
  // pauses are ignored and only a sustained ~3s silence finalizes the turn.
  const armSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = window.setTimeout(() => {
      silenceTimerRef.current = null;
      if (stateRef.current !== "listening") return;
      logVoice("silence-timeout");
      setState("thinking");
      providerRef.current?.stop();
    }, SILENCE_MS);
  }, [clearSilenceTimer]);

  const playTTS = useCallback(
    (text: string) => {
      speakingRef.current = true;
      setState("speaking");
      logVoice("tts-started");
      void speak(text, {
        rate: SPEAKING_RATE[settings.speakingSpeed],
        voiceURI: settings.voiceURI,
        onStart: () => logVoice("tts-speaking"),
        onEnd: () => {
          speakingRef.current = false;
          logVoice("tts-finished");
          setState("idle");
        },
      });
    },
    [settings.speakingSpeed, settings.voiceURI],
  );

  const commit = useCallback(
    async (rawText: string) => {
      const text = cleanupTranscript(rawText);
      logVoice("transcript-cleaned", text);
      if (!text) {
        setState("idle");
        return;
      }
      const sender = senderRef.current;
      if (!sender) {
        setState("idle");
        return;
      }

      setLastUserMessage(text);
      setState("thinking");
      setPartial("");
      setError(null);
      logVoice("request-dispatched");
      try {
        const reply = await sender(text);
        setLastReply(reply);
        logVoice("response-received");
        if (settings.ttsMode === "always" && support.synthesis) {
          // Begin speaking shortly after the reply lands so the first words
          // appear on screen at the same time the voice starts.
          window.setTimeout(() => playTTS(reply), 450);
        } else {
          setState("idle");
        }
      } catch {
        setState("error");
        setError("I couldn't reach the assistant. Try again.");
      }
    },
    [settings.ttsMode, settings.speakingSpeed, settings.voiceURI, support.synthesis, playTTS],
  );

  const finishListening = useCallback(() => {
    clearSilenceTimer();
    const text = finalRef.current.trim();
    if (cancelledRef.current) {
      cancelledRef.current = false;
      finalRef.current = "";
      setFinal("");
      setState("idle");
      return;
    }
    // A fatal recognition error already surfaced; keep it visible and let the
    // next `start()` clear it.
    if (stateRef.current === "error") {
      committedRef.current = false;
      return;
    }
    if (!text || committedRef.current) {
      if (stateRef.current !== "speaking") setState("idle");
      return;
    }
    committedRef.current = true;
    if (settings.confirmLowConfidence && confidenceRef.current < settings.confidenceThreshold) {
      setState("confirm");
    } else {
      void commit(text);
    }
  }, [settings.confirmLowConfidence, settings.confidenceThreshold, commit]);

  const start = useCallback(() => {
    if (!support.recognition) {
      setState("error");
      setError(mapError("unsupported"));
      return;
    }

    // Interrupt any ongoing speech and take over.
    if (speakingRef.current) {
      cancelSpeech();
      speakingRef.current = false;
    }

    setError(null);
    setPartial("");
    finalRef.current = "";
    confidenceRef.current = 0;
    setFinal("");
    setConfidence(0);
    committedRef.current = false;
    cancelledRef.current = false;
    lastSpeechRef.current = Date.now();
    setState("listening");
    armSilenceTimer();

    const provider = providerRef.current ?? createTranscriptionProvider();
    providerRef.current = provider;
    logVoice("mic-started");
    provider.start({
      onStart: () => {
        logVoice("recognition-started");
        setState("listening");
      },
      onPartial: (text) => {
        logVoice("interim", text);
        setPartial(text);
        lastSpeechRef.current = Date.now();
        armSilenceTimer();
      },
      onFinal: (res: TranscriptResult) => {
        logVoice("final", res.transcript);
        finalRef.current = res.transcript;
        confidenceRef.current = res.confidence;
        setFinal(res.transcript);
        setConfidence(res.confidence);
        lastSpeechRef.current = Date.now();
        armSilenceTimer();
      },
      onError: (code) => {
        if (code === "no-speech" || code === "aborted") return; // onend restarts
        logVoice("recognition-error", code);
        setState("error");
        setError(mapError(code));
      },
      onEnd: () => finishListening(),
    });
  }, [support.recognition, armSilenceTimer, finishListening]);

  const stop = useCallback(() => {
    logVoice("mic-stop-requested");
    providerRef.current?.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    providerRef.current?.abort();
  }, []);

  const confirm = useCallback(() => {
    const text = finalRef.current.trim();
    if (text) void commit(text);
  }, [commit]);

  const reject = useCallback(() => {
    finalRef.current = "";
    setFinal("");
    setConfidence(0);
    setState("idle");
  }, []);

  const replayLast = useCallback(() => {
    if (!lastReply) return;
    if (speakingRef.current) {
      cancelSpeech();
      speakingRef.current = false;
    }
    playTTS(lastReply);
  }, [lastReply, playTTS]);

  // Keep fresh references for the keyboard handler.
  const startRef = useRef(start);
  startRef.current = start;
  const stopRef = useRef(stop);
  stopRef.current = stop;

  // Keyboard shortcuts: hold Space to talk; Ctrl/Cmd+Space or Alt+Space to
  // toggle. Ignored while typing in a field or activating a button.
  useEffect(() => {
    const isEditableTarget = (el: EventTarget | null): boolean => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "BUTTON" ||
        node.isContentEditable ||
        node.getAttribute?.("role") === "textbox"
      );
    };

    let spaceHeld = false;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (isEditableTarget(e.target)) return;

      // Ctrl/Alt/Cmd + Space → push-to-talk toggle.
      if (e.ctrlKey || e.altKey || e.metaKey) {
        e.preventDefault();
        const s = stateRef.current;
        if (s === "idle" || s === "confirm" || s === "error") startRef.current();
        else stopRef.current();
        return;
      }

      // Plain Space → hold to talk.
      if (e.repeat) return;
      e.preventDefault();
      spaceHeld = true;
      if (stateRef.current === "idle") startRef.current();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (isEditableTarget(e.target)) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (spaceHeld) {
        spaceHeld = false;
        if (stateRef.current === "listening") stopRef.current();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    return () => {
      clearSilenceTimer();
      providerRef.current?.abort();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* ignore */
        }
      }
    };
  }, [clearSilenceTimer]);

  const value = useMemo<VoiceContextValue>(
    () => ({
      state,
      partial,
      final,
      confidence,
      error,
      settings,
      support,
      lastReply,
      lastUserMessage,
      setSettings,
      registerSender,
      start,
      stop,
      cancel,
      confirm,
      reject,
      replayLast,
    }),
    [
      state,
      partial,
      final,
      confidence,
      error,
      settings,
      support,
      lastReply,
      lastUserMessage,
      registerSender,
      start,
      stop,
      cancel,
      confirm,
      reject,
      replayLast,
    ],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceContextValue {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error("useVoice must be used within a VoiceProvider");
  return ctx;
}
