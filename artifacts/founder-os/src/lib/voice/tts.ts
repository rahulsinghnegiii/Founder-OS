// Text-to-speech via the browser SpeechSynthesis API, plus transcript cleanup.

export interface VoiceOption {
  name: string;
  uri: string;
  lang: string;
}

export function isTTSSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

let currentUtterance: SpeechSynthesisUtterance | null = null;

export function cancelSpeech(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
  currentUtterance = null;
}

function pickDefaultVoice(): SpeechSynthesisVoice | undefined {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return undefined;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return undefined;
  return (
    voices.find((v) => /en[-_]US/i.test(v.lang) && /(female|samantha|google us|zira|aria|natural)/i.test(v.name)) ||
    voices.find((v) => /^en/i.test(v.lang)) ||
    voices[0]
  );
}

export function listVoices(): VoiceOption[] {
  if (!isTTSSupported()) return [];
  return window.speechSynthesis
    .getVoices()
    .map((v) => ({ name: v.name, uri: v.voiceURI, lang: v.lang }));
}

export interface SpeakOptions {
  rate?: number;
  voiceURI?: string | null;
  onStart?: () => void;
  onEnd?: () => void;
}

/**
 * Speak text aloud. Resolves when playback finishes (or immediately if
 * unsupported / empty). `onStart`/`onEnd` fire around actual playback.
 */
export function speak(text: string, opts?: SpeakOptions): Promise<void> {
  return new Promise((resolve) => {
    if (!isTTSSupported() || !text.trim()) {
      resolve();
      return;
    }
    cancelSpeech();
    const synth = window.speechSynthesis;
    const plain = text
      .replace(/[*_`#>]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    const u = new SpeechSynthesisUtterance(plain);
    u.rate = opts?.rate ?? 1.0;
    u.pitch = 1.0;
    u.volume = 1;

    const voice = opts?.voiceURI
      ? synth.getVoices().find((v) => v.voiceURI === opts.voiceURI)
      : pickDefaultVoice();
    if (voice) u.voice = voice;

    currentUtterance = u;
    u.onstart = () => opts?.onStart?.();
    u.onend = () => {
      currentUtterance = null;
      opts?.onEnd?.();
      resolve();
    };
    u.onerror = () => {
      currentUtterance = null;
      opts?.onEnd?.();
      resolve();
    };

    synth.speak(u);
  });
}

/**
 * Conservative, intent-safe normalization of a raw transcript before it is sent
 * to the assistant. We only strip obvious speech artifacts: fillers, repeated
 * words, long pauses (collapsed whitespace). We never rewrite meaning.
 */
export function cleanupTranscript(text: string): string {
  let t = text.replace(/\s+/g, " ").trim();

  // Obvious verbal fillers.
  t = t.replace(/\b(uh+|um+|umm+|hmm+|er+|erm+|ah+|mm+|huh+)\b/gi, "");

  // Filler phrases that rarely carry intent.
  t = t.replace(
    /\b(you know|i mean|i guess|sort of|kind of|kinda|basically|actually|well|so|right|okay|ok|yeah|yea|yep|yup|literally|just)\b/gi,
    "",
  );

  // "like" only as a filler — keep "would like", "looks like", "sounds like",
  // "feels like", and "like to / like a / like the …".
  t = t.replace(
    /(?<!\w)(?:would |looks |sounds |feels |seems |tastes )?like\b(?!\s+(?:to|a|an|the|my|our|your|this|that|these|those|something|someone|it|him|her|them|us|what|how|when|where|why|who))/gi,
    (m) =>
      /^(would|looks|sounds|feels|seems|tastes)\b/i.test(m.trim()) || /^would/i.test(m.trim())
        ? m
        : "",
  );

  // Collapse duplicated words ("the the", "create create").
  for (let i = 0; i < 2; i++) {
    t = t.replace(/\b(\w+)\s+\1\b/gi, "$1");
  }

  // Fix spacing around punctuation.
  t = t.replace(/\s+/g, " ").replace(/\s+([.,!?])/g, "$1").trim();

  return t;
}
