/**
 * Parse a date-ish value into a real Date, tolerating natural-language input
 * the founder might type ("friday", "tomorrow", "next week", ISO strings).
 * Returns null when nothing sensible can be derived so callers can store NULL
 * instead of crashing on `new Date(badValue)`.
 */
export function safeDate(v?: string | null): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;

  const direct = new Date(s);
  if (!Number.isNaN(direct.getTime())) return direct;

  const lower = s.toLowerCase();
  const now = new Date();
  const at = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + n);
    d.setHours(9, 0, 0, 0);
    return d;
  };

  if (lower === "today") return at(0);
  if (lower === "tomorrow" || lower === "tmr" || lower === "tmrw") return at(1);
  if (lower === "yesterday") return at(-1);
  if (lower.startsWith("next week")) return at(7);
  if (lower.startsWith("next month")) return at(30);

  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const idx = days.findIndex((d) => lower.includes(d));
  if (idx >= 0) {
    let diff = idx - now.getDay();
    if (diff <= 0) diff += 7;
    return at(diff);
  }

  return null;
}
