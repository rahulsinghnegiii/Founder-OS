import React, { useCallback, useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type GateState = "loading" | "locked" | "open";

/**
 * Blocks the app behind the single-founder password when the server has
 * APP_PASSWORD set. When it is not set the gate is invisible.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>("loading");

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/status", { credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { required: boolean; authenticated: boolean };
      setState(data.required && !data.authenticated ? "locked" : "open");
    } catch {
      // If the status endpoint is unreachable, let the app render; pages show their own API errors.
      setState("open");
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (state === "loading") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-sm text-muted-foreground">
        Loading FounderOS…
      </div>
    );
  }

  if (state === "locked") {
    return <LoginScreen onSuccess={check} />;
  }

  return <>{children}</>;
}

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setPassword("");
        onSuccess();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? (res.status === 429 ? "Too many attempts. Try again later." : "Wrong password"));
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background p-4">
      <div className="soft-grid pointer-events-none fixed inset-0" />
      <form
        onSubmit={submit}
        className="relative w-full max-w-sm space-y-5 rounded-[2rem] border-2 border-zinc-950 bg-white/95 p-8 shadow-[10px_10px_0px_var(--shadow-ink)]"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border-2 border-zinc-950 bg-rose-300">
            <Lock className="h-6 w-6 text-zinc-950" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-[-0.05em]">FounderOS</h1>
            <p className="text-sm text-muted-foreground">Enter your password to open headquarters.</p>
          </div>
        </div>
        <Input
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Password"
        />
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        <Button type="submit" disabled={busy || !password} className="w-full rounded-2xl bg-zinc-950 text-white hover:bg-zinc-900">
          {busy ? "Checking…" : "Unlock"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Set with <code>APP_PASSWORD</code> on the server.
        </p>
      </form>
    </div>
  );
}
