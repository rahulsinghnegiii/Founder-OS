import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Reveals text progressively to mimic streaming. Each mount animates once; if
 * the same text is re-rendered it stays put. Good for assistant replies.
 */
export function StreamingText({
  text,
  className,
  caret = true,
  speed = 22,
}: {
  text: string;
  className?: string;
  caret?: boolean;
  speed?: number;
}) {
  const [shown, setShown] = useState("");
  const doneRef = useRef(false);

  useEffect(() => {
    doneRef.current = false;
    setShown("");
    if (!text) return;
    const total = text.length;
    const step = Math.max(1, Math.round(total / 110)); // ~2s for a long reply
    let i = 0;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      if (now - last >= speed) {
        i = Math.min(total, i + step + Math.floor((now - last) / speed));
        last = now;
        setShown(text.slice(0, i));
        if (i >= total) {
          doneRef.current = true;
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, speed]);

  return (
    <span className={cn(className)}>
      {shown}
      {caret && !doneRef.current && (
        <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-rose-400 align-middle" />
      )}
    </span>
  );
}
