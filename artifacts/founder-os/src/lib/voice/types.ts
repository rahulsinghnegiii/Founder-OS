// Shared types for the FounderOS voice layer.

/**
 * The voice interaction state machine.
 * - idle: nothing happening
 * - listening: capturing speech, showing live transcript
 * - thinking: transcript sent, assistant reasoning
 * - speaking: assistant reply being read aloud
 * - interrupted: user took over mid-speech (transient)
 * - confirm: low-confidence transcript awaiting user confirmation
 * - error: recognition or delivery failed
 */
export type VoiceState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "confirm"
  | "error";

/** When (if ever) the assistant reads replies aloud. */
export type TtsMode = "off" | "on_demand" | "always";

/** Playback rate for speech output. */
export type VoiceSpeed = "slow" | "normal" | "fast";

export interface VoiceSettings {
  /** off = never speak; on_demand = speaker button only; always = auto-speak every reply. */
  ttsMode: TtsMode;
  /** Speaking speed for voice playback. */
  speakingSpeed: VoiceSpeed;
  /** Selected voice URI, or null for the default browser voice. */
  voiceURI: string | null;
  /** When the transcript confidence is low, ask the founder to confirm before executing. */
  confirmLowConfidence: boolean;
  /** 0..1 confidence floor below which we request confirmation. */
  confidenceThreshold: number;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  ttsMode: "off",
  speakingSpeed: "normal",
  voiceURI: null,
  confirmLowConfidence: true,
  confidenceThreshold: 0.55,
};

export const SPEAKING_RATE: Record<VoiceSpeed, number> = {
  slow: 0.85,
  normal: 1.0,
  fast: 1.18,
};

export interface VoiceSupport {
  recognition: boolean;
  synthesis: boolean;
}

/** A finalized (or partially finalized) recognition result. */
export interface TranscriptResult {
  transcript: string;
  isFinal: boolean;
  confidence: number;
}

export interface TranscriptionHandlers {
  onStart?: () => void;
  onPartial?: (text: string) => void;
  onFinal?: (result: TranscriptResult) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

/**
 * Abstraction over a speech-to-text engine. The UI only depends on this
 * interface, so the Web Speech API implementation can later be swapped for a
 * remote provider (Whisper, Deepgram, etc.) without touching the UI.
 */
export interface TranscriptionProvider {
  readonly name: string;
  start(handlers: TranscriptionHandlers): void;
  stop(): void;
  abort(): void;
  isSupported(): boolean;
}

/** A function that delivers a transcribed message to the assistant and resolves with the reply. */
export type VoiceSender = (text: string) => Promise<string>;
