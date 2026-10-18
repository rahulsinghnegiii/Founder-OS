import type { TranscriptionHandlers, TranscriptionProvider } from "./types";

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function getRecognitionCtor(): { new (): SpeechRecognition } | undefined {
  if (typeof window === "undefined") return undefined;
  return window.SpeechRecognition || window.webkitSpeechRecognition;
}

// Events that are not real failures — the session simply went quiet and the
// caller (VoiceProvider) decides whether to keep listening.
const TRANSIENT_ERRORS = new Set(["no-speech", "aborted"]);

/**
 * Browser-native speech recognition via the Web Speech API.
 *
 * Chrome ends `SpeechRecognition` after a short silence even in `continuous`
 * mode, so we treat `onend` as "the mic went quiet, possibly only briefly" and
 * restart a fresh instance transparently while the caller is still listening.
 * The caller owns the real end-of-utterance decision (a silence timer); we only
 * stop restarting once the caller calls `stop()`/`abort()`.
 */
export class WebSpeechTranscriptionProvider implements TranscriptionProvider {
  readonly name = "web-speech";
  private recognition: SpeechRecognition | null = null;
  private handlers: TranscriptionHandlers | null = null;
  private finalTranscript = "";
  private manualStop = false;
  private restartTimer: number | null = null;

  start(handlers: TranscriptionHandlers): void {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      handlers.onError?.("unsupported");
      return;
    }
    this.handlers = handlers;
    this.manualStop = false;
    this.finalTranscript = "";
    this.spawn();
  }

  private spawn(): void {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => this.handlers?.onStart?.();

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          this.finalTranscript += (this.finalTranscript ? " " : "") + text;
          this.handlers?.onFinal?.({
            transcript: this.finalTranscript.trim(),
            isFinal: true,
            confidence: result[0]?.confidence ?? 0,
          });
        } else {
          interim += text;
        }
      }
      this.handlers?.onPartial?.(this.finalTranscript + (interim ? " " + interim : ""));
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      const code = event.error || "error";
      // Transient: let `onend` restart the session so listening continues.
      if (TRANSIENT_ERRORS.has(code)) return;
      // Fatal: surface once and stop trying to listen.
      this.manualStop = true;
      this.handlers?.onError?.(code);
    };

    rec.onend = () => {
      if (this.restartTimer !== null) {
        clearTimeout(this.restartTimer);
        this.restartTimer = null;
      }
      if (this.manualStop) {
        this.handlers?.onEnd?.();
        return;
      }
      // Chrome ended recognition early (brief silence / 60s cap). Restart
      // quietly so the founder is never cut off mid-thought.
      this.restartTimer = window.setTimeout(() => this.spawn(), 60);
    };

    this.recognition = rec;
    try {
      rec.start();
    } catch {
      // start() can throw if called too quickly after a previous stop; the
      // onend restart timer will retry shortly.
    }
  }

  stop(): void {
    this.manualStop = true;
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.recognition?.stop();
  }

  abort(): void {
    this.manualStop = true;
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    try {
      this.recognition?.abort();
    } catch {
      /* ignore */
    }
  }

  isSupported(): boolean {
    return isSpeechRecognitionSupported();
  }
}

/** Used when no recognition engine is available; reports the failure immediately. */
class UnsupportedTranscriptionProvider implements TranscriptionProvider {
  readonly name = "unsupported";
  start(handlers: TranscriptionHandlers): void {
    handlers.onError?.("unsupported");
  }
  stop(): void {}
  abort(): void {}
  isSupported(): boolean {
    return false;
  }
}

/**
 * Build the active transcription provider. Today this is always the browser's
 * Web Speech API. To use a remote engine later, return that provider here based
 * on configuration — the rest of the app is unchanged.
 */
export function createTranscriptionProvider(): TranscriptionProvider {
  return isSpeechRecognitionSupported()
    ? new WebSpeechTranscriptionProvider()
    : new UnsupportedTranscriptionProvider();
}
