import React, { useEffect, useState } from "react";
import { useGetOnboarding, useUpdateOnboarding } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { ArrowRight, Check } from "lucide-react";

const STEPS = [
  {
    id: "welcome",
    code: "01",
    label: "WELCOME",
    title: "Your company, run by an operating system.",
    desc: "FounderOS gives you an AI Sales department and an Executive Assistant that act on your words. More departments are on the way. Let's bring it online.",
  },
  {
    id: "profile",
    code: "02",
    label: "COMPANY PROFILE",
    title: "First, the basics.",
    desc: "Tell me about the company you're building and I'll keep it as context for everything that follows.",
  },
  {
    id: "agents",
    code: "03",
    label: "AGENTS ONLINE",
    title: "Your departments are waking up.",
    desc: "Your Sales agent is standing by to watch the pipeline, draft follow-ups, and score new leads. Marketing, Operations, and Strategy are coming soon.",
  },
  {
    id: "complete",
    code: "04",
    label: "READY",
    title: "You're live.",
    desc: "The command center is yours. Start by telling your Assistant what to do.",
  },
];

const INK = "#0E1320";
const PANEL = "#141B2B";
const LINE = "#283245";
const TEXT = "#E8ECF4";
const MUTED = "#8A95AB";
const SIGNAL = "#F5A524";

export default function Onboarding() {
  const { data: onboarding } = useGetOnboarding();
  const { mutate: updateOnboarding, isPending } = useUpdateOnboarding();
  const [, setLocation] = useLocation();
  const [mounted, setMounted] = useState(false);

  const currentStepId = onboarding?.currentStep || "welcome";
  const currentIndex = STEPS.findIndex((s) => s.id === currentStepId);
  const step = STEPS[currentIndex] ?? STEPS[0];
  const isLast = currentIndex === STEPS.length - 1;
  const progress = (currentIndex / (STEPS.length - 1)) * 100;

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 60);
    return () => clearTimeout(t);
  }, []);

  const handleNext = () => {
    if (currentIndex < STEPS.length - 1) {
      updateOnboarding({ data: { currentStep: STEPS[currentIndex + 1].id } });
    } else {
      updateOnboarding({ data: { completedAt: new Date().toISOString() } }, { onSuccess: () => setLocation("/") });
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: INK, color: TEXT, fontFamily: "Manrope, system-ui, sans-serif" }}
    >
      <style>{`
        @keyframes bootIn { from { opacity: 0; transform: translateX(8px); } to { opacity: 1; transform: none; } }
        @keyframes amberPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
        .boot-line { opacity: 0; transform: translateX(8px); transition: opacity .5s ease, transform .5s ease; }
        .boot-line.is-in { animation: bootIn .5s ease forwards; }
        .amber-pulse { animation: amberPulse 1.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .boot-line, .amber-pulse { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
      `}</style>

      {/* Top status bar */}
      <header
        className="flex items-center justify-between px-6 md:px-10 py-4 border-b text-[11px] tracking-[0.28em] uppercase"
        style={{ borderColor: LINE, color: MUTED, fontFamily: "'IBM Plex Mono', monospace" }}
      >
        <span>
          FounderOS <span style={{ color: SIGNAL }}>·</span> OS
        </span>
        <span style={{ color: isLast ? SIGNAL : MUTED }}>
          {isLast ? "system: online" : "system: initializing"}
        </span>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(280px,0.85fr)_1.4fr] gap-0">
        {/* Left: boot log / signature element */}
        <aside
          className="border-b lg:border-b-0 lg:border-r p-8 md:p-10 flex flex-col"
          style={{ borderColor: LINE, background: PANEL }}
        >
          <p
            className="text-[11px] tracking-[0.3em] uppercase mb-8"
            style={{ color: MUTED, fontFamily: "'IBM Plex Mono', monospace" }}
          >
            Boot log
          </p>

          <div className="space-y-1">
            {STEPS.map((s, idx) => {
              const done = idx < currentIndex;
              const active = idx === currentIndex;
              return (
                <div
                  key={s.id}
                  className={`boot-line flex items-center gap-3 py-2.5 ${mounted ? "is-in" : ""}`}
                  style={{ transitionDelay: `${idx * 90}ms` }}
                >
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center"
                    style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}
                  >
                    {done ? (
                      <Check className="h-4 w-4" style={{ color: SIGNAL }} />
                    ) : active ? (
                      <span className="amber-pulse" style={{ color: SIGNAL, fontSize: 14 }}>
                        ▸
                      </span>
                    ) : (
                      <span style={{ color: MUTED }}>·</span>
                    )}
                  </span>
                  <span
                    className="text-[13px] tracking-[0.18em]"
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      color: done ? MUTED : active ? SIGNAL : MUTED,
                      opacity: active ? 1 : 0.75,
                    }}
                  >
                    {s.code} &nbsp;{s.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Progress rail */}
          <div className="mt-auto pt-10">
            <div className="h-[3px] w-full rounded-full" style={{ background: LINE }}>
              <div
                className="h-[3px] rounded-full transition-[width] duration-700 ease-out"
                style={{ width: `${progress}%`, background: SIGNAL }}
              />
            </div>
            <p
              className="mt-3 text-[11px] tracking-[0.2em] uppercase"
              style={{ color: MUTED, fontFamily: "'IBM Plex Mono', monospace" }}
            >
              {Math.round(progress)}% complete
            </p>
          </div>
        </aside>

        {/* Right: current step */}
        <section className="p-8 md:p-14 flex flex-col justify-center max-w-2xl">
          <p
            className="text-[11px] tracking-[0.3em] uppercase mb-6"
            style={{ color: MUTED, fontFamily: "'IBM Plex Mono', monospace" }}
          >
            Step {step.code} / 0{STEPS.length}
          </p>

          <h1
            className="text-4xl md:text-5xl leading-[1.05] tracking-[-0.02em] mb-6"
            style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700 }}
          >
            {step.title}
          </h1>

          <p className="text-lg leading-relaxed max-w-xl" style={{ color: MUTED }}>
            {step.desc}
          </p>

          <div className="mt-12">
            <button
              onClick={handleNext}
              disabled={isPending}
              className="group inline-flex items-center gap-3 rounded-full px-7 py-4 text-sm font-semibold tracking-wide transition disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
              style={{
                background: SIGNAL,
                color: "#1A1205",
                fontFamily: "'IBM Plex Mono', monospace",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.filter = "brightness(1.08)")}
              onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
            >
              {isLast ? "Enter Command Center" : "Continue"}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
