import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A useState-compatible hook that persists its value to localStorage.
 * SSR/first-paint safe: reads synchronously on mount, writes on change.
 */
export function usePersistentState<T>(key: string, initialValue: T) {
  const readValue = useCallback((): T => {
    if (typeof window === "undefined") return initialValue;
    try {
      const raw = window.localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initialValue;
    } catch {
      return initialValue;
    }
  }, [key, initialValue]);

  const [value, setValue] = useState<T>(readValue);
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    try {
      window.localStorage.setItem(keyRef.current, JSON.stringify(value));
    } catch {
      /* storage unavailable — ignore */
    }
  }, [value]);

  return [value, setValue] as const;
}
