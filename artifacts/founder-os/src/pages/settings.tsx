import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bot, CheckCircle, Cpu, KeyRound, LogOut, Mail, Mic, Plug, RefreshCw, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useVoice } from "@/lib/voice/VoiceProvider";
import type { TtsMode } from "@/lib/voice/types";
import { listVoices, type VoiceOption } from "@/lib/voice/tts";

interface ServerProvider {
  name: string;
  label: string;
  envHint: string;
  status: "active" | "configured" | "not_configured";
  model: string | null;
}

interface ActiveProvider {
  name: string;
  label: string;
  model: string;
  configured: boolean;
}

interface ProviderTestResult {
  success: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  reply: string | null;
  error: string | null;
}

interface ModelInfo {
  id: string;
  provider: string;
  displayName: string;
  tier: string;
  contextWindow: number;
  supportsJson: boolean;
  suitableFor: string[];
  costPer1kInput: number;
  costPer1kOutput: number;
}

interface ProvidersResponse {
  active: ActiveProvider;
  providers: ServerProvider[];
  models: ModelInfo[];
  authRequired?: boolean;
  mcp?: {
    enabled: boolean;
    problem: string | null;
    publicUrl: string | null;
    tools: { name: string; writes: boolean }[];
  };
  note?: string;
}

export default function Settings() {
  const [data, setData] = useState<ProvidersResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/settings/providers")
      .then((res) => res.json())
      .then((response: ProvidersResponse) => {
        if (active) setData(response);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const models = data?.models ?? [];
  const active = data?.active;
  const activeConfigured = Boolean(active && active.name !== "none" && active.configured);

  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/providers/test", { method: "POST" });
      setTestResult((await res.json()) as ProviderTestResult);
    } catch {
      setTestResult({ success: false, provider: active?.name ?? "none", model: "", latencyMs: 0, reply: null, error: "Could not reach the server." });
    } finally {
      setTesting(false);
    }
  };

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.reload();
  };

  const { settings: voiceSettings, setSettings: setVoiceSettings, support } = useVoice();
  const ttsOptions: { value: TtsMode; label: string; hint: string }[] = [
    { value: "off", label: "Off", hint: "Never reads replies aloud." },
    { value: "on_demand", label: "On demand", hint: "Tap to replay a reply." },
    { value: "always", label: "Always", hint: "Speaks every reply." },
  ];
  const speedOptions: { value: "slow" | "normal" | "fast"; label: string }[] = [
    { value: "slow", label: "Slow" },
    { value: "normal", label: "Normal" },
    { value: "fast", label: "Fast" },
  ];

  const [voices, setVoices] = useState<VoiceOption[]>([]);
  useEffect(() => {
    const load = () => setVoices(listVoices());
    load();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.onvoiceschanged = load;
      return () => {
        window.speechSynthesis.onvoiceschanged = null;
      };
    }
    return undefined;
  }, []);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Settings</h1>
        <p className="text-muted-foreground">
          FounderOS configuration. AI keys live in the server&apos;s <code>.env</code>, never in the browser.
        </p>
      </div>

      <Card className="bg-card border-border/50">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl border", activeConfigured ? "border-emerald-400 bg-emerald-100" : "border-amber-400 bg-amber-100")}>
              <KeyRound className={cn("h-5 w-5", activeConfigured ? "text-emerald-600" : "text-amber-600")} />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle>AI Provider</CardTitle>
              <CardDescription className="mt-1">
                {loading ? (
                  "Checking provider status…"
                ) : activeConfigured && active ? (
                  <span className="flex items-center gap-1.5 text-emerald-700">
                    <CheckCircle className="h-4 w-4" />
                    {active.label} is active · model <code className="text-xs">{active.model}</code>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-amber-700">
                    <AlertTriangle className="h-4 w-4" />
                    No AI provider configured. Add a key to <code className="text-xs">.env</code> and restart.
                  </span>
                )}
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={runTest} disabled={testing || loading}>
              <Zap className="mr-1.5 h-3.5 w-3.5" /> {testing ? "Testing…" : "Test connection"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {testResult ? (
            <p className={cn("rounded-2xl border px-4 py-3 text-sm", testResult.success ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900")}>
              {testResult.success
                ? `Connected to ${testResult.provider} (${testResult.model}) in ${testResult.latencyMs} ms. Reply: "${testResult.reply}"`
                : `Test failed: ${testResult.error}`}
            </p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {(data?.providers ?? []).map((provider) => (
              <div key={provider.name} className={cn("flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm", provider.status === "active" ? "border-emerald-300 bg-emerald-50" : "border-border/60 bg-white/60")}>
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{provider.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {provider.status === "not_configured" ? `Set ${provider.envHint}` : provider.model}
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className={cn("shrink-0 text-[10px]", provider.status === "active" ? "border-emerald-300 bg-emerald-100 text-emerald-800" : provider.status === "configured" ? "border-sky-300 bg-sky-50 text-sky-800" : "border-slate-200 bg-white text-slate-500")}
                >
                  {provider.status === "active" ? "Active" : provider.status === "configured" ? "Ready" : "Not set"}
                </Badge>
              </div>
            ))}
          </div>
          {data?.note ? (
            <p className="rounded-2xl border border-border/60 bg-white/60 px-4 py-3 text-sm text-slate-600">
              {data.note}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="bg-card border-border/50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-secondary">
              <Cpu className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Available Models</CardTitle>
              <CardDescription>
                Models the active provider can route tasks to, by capability.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-2/3" />
            </div>
          ) : models.length === 0 ? (
            <p className="text-sm text-muted-foreground">No models reported.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {models.map((model) => (
                <Badge
                  key={model.id}
                  variant="secondary"
                  className={`text-[10px] font-normal ${
                    model.tier === "premium"
                      ? "border-violet-300 bg-violet-50 text-violet-700"
                      : model.tier === "cheap"
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  {model.displayName}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card border-border/50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-secondary">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Assistant</CardTitle>
              <CardDescription>
                The Executive Assistant is always available from the EA Desk.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      <GmailCard />

      {data?.mcp ? <McpCard mcp={data.mcp} /> : null}

      {data?.authRequired ? (
        <Card className="bg-card border-border/50">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-secondary">
                  <LogOut className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle>Session</CardTitle>
                  <CardDescription>This instance is password protected.</CardDescription>
                </div>
              </div>
              <Button size="sm" variant="outline" className="rounded-xl" onClick={signOut}>
                Sign out
              </Button>
            </div>
          </CardHeader>
        </Card>
      ) : null}

      <Card className="bg-card border-border/50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-rose-300 bg-rose-100">
              <Mic className="h-5 w-5 text-rose-600" />
            </div>
            <div>
              <CardTitle>Voice</CardTitle>
              <CardDescription>
                Talk to your assistant naturally — speech recognition runs in your browser, not on our servers.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <p className="text-sm font-medium text-slate-800">Voice replies</p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {ttsOptions.map((opt) => {
                const active = voiceSettings.ttsMode === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setVoiceSettings({ ...voiceSettings, ttsMode: opt.value })}
                    className={cn(
                      "rounded-[1.2rem] border px-3.5 py-3 text-left text-sm shadow-sm transition-transform hover:-translate-y-0.5",
                      active
                        ? "border-zinc-950 bg-zinc-950 text-white"
                        : "border-border bg-white text-slate-700",
                    )}
                  >
                    <p className="font-medium">{opt.label}</p>
                    <p className={cn("mt-0.5 text-xs", active ? "text-white/70" : "text-muted-foreground")}>
                      {opt.hint}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-800">Speaking speed</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {speedOptions.map((opt) => {
                const active = voiceSettings.speakingSpeed === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setVoiceSettings({ ...voiceSettings, speakingSpeed: opt.value })}
                    className={cn(
                      "rounded-[1.2rem] border px-3.5 py-3 text-center text-sm font-medium shadow-sm transition-transform hover:-translate-y-0.5",
                      active ? "border-zinc-950 bg-zinc-950 text-white" : "border-border bg-white text-slate-700",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-800">Voice</p>
            <select
              value={voiceSettings.voiceURI ?? ""}
              onChange={(e) => setVoiceSettings({ ...voiceSettings, voiceURI: e.target.value || null })}
              className="mt-2 w-full rounded-[1.2rem] border-2 border-border bg-white px-3.5 py-2.5 text-sm text-slate-700 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Default browser voice</option>
              {voices.map((v) => (
                <option key={v.uri} value={v.uri}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px] font-normal",
                support.recognition
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-rose-300 bg-rose-50 text-rose-700",
              )}
            >
              {support.recognition ? "Speech recognition ready" : "Speech recognition unavailable"}
            </Badge>
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px] font-normal",
                support.synthesis
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-rose-300 bg-rose-50 text-rose-700",
              )}
            >
              {support.synthesis ? "Voice playback ready" : "Voice playback unavailable"}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface GmailStatus {
  configured: boolean;
  problem: string | null;
  connected: boolean;
  needsReconnect: boolean;
  accountEmail: string | null;
  lastSyncedAt: string | null;
  lastSync: {
    messagesRead: number;
    leadsMatched: number;
    clocksMoved: number;
    draftsClosed: number;
    truncated: boolean;
  } | null;
  lastError: string | null;
  syncing: boolean;
  redirectUri: string | null;
  intervalMinutes: number;
}

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

function syncSummary(s: NonNullable<GmailStatus["lastSync"]>): string {
  return `Read ${s.messagesRead} email${s.messagesRead === 1 ? "" : "s"}, matched ${s.leadsMatched} lead${s.leadsMatched === 1 ? "" : "s"}, reset ${s.clocksMoved} silence clock${s.clocksMoved === 1 ? "" : "s"}, closed ${s.draftsClosed} draft${s.draftsClosed === 1 ? "" : "s"}.${s.truncated ? " Stopped at the message limit." : ""}`;
}

function GmailCard() {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [busy, setBusy] = useState<"connect" | "sync" | "disconnect" | null>(null);
  // Google sends the browser back to /settings?gmail=connected|error&reason=...
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("gmail") === "connected") return { ok: true, text: "Gmail connected. FounderOS is reading your recent email headers now." };
    if (params.get("gmail") === "error") return { ok: false, text: params.get("reason") ?? "Gmail connection failed." };
    return null;
  });

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("gmail")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/gmail");
      if (res.ok) setStatus((await res.json()) as GmailStatus);
    } catch {
      // Keep the last known status.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while a sync runs, e.g. the first one right after connecting.
  useEffect(() => {
    if (!status?.syncing) return undefined;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [status?.syncing, load]);

  const request = async (kind: "connect" | "sync" | "disconnect") => {
    setBusy(kind);
    setNotice(null);
    try {
      const res =
        kind === "connect"
          ? await fetch("/api/integrations/gmail/connect", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ origin: window.location.origin }),
            })
          : kind === "sync"
            ? await fetch("/api/integrations/gmail/sync", { method: "POST" })
            : await fetch("/api/integrations/gmail", { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `Request failed (${res.status})`);

      if (kind === "connect" && typeof body.url === "string") {
        window.location.assign(body.url);
        return;
      }
      if (kind === "sync") setNotice({ ok: true, text: syncSummary(body as unknown as NonNullable<GmailStatus["lastSync"]>) });
      if (kind === "disconnect") setNotice({ ok: true, text: "Gmail disconnected and its saved token deleted." });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setBusy(null);
      void load();
    }
  };

  const redirectUri = status?.redirectUri ?? `${window.location.origin}/api/integrations/gmail/callback`;
  const healthy = Boolean(status?.connected && !status.needsReconnect);
  const syncing = busy === "sync" || Boolean(status?.syncing);

  return (
    <Card className="bg-card border-border/50">
      <CardHeader>
        <div className="flex flex-wrap items-start gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
              healthy ? "border-emerald-400 bg-emerald-100" : status?.needsReconnect ? "border-amber-400 bg-amber-100" : "border-slate-300 bg-secondary",
            )}
          >
            <Mail className={cn("h-5 w-5", healthy ? "text-emerald-600" : status?.needsReconnect ? "text-amber-600" : "text-slate-600")} />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle>Gmail sync</CardTitle>
            <CardDescription className="mt-1">
              {!status ? (
                "Checking Gmail…"
              ) : status.needsReconnect ? (
                <span className="flex items-center gap-1.5 text-amber-700">
                  <AlertTriangle className="h-4 w-4" /> Needs reconnecting
                </span>
              ) : status.connected ? (
                <span className="flex flex-wrap items-center gap-1.5 text-emerald-700">
                  <CheckCircle className="h-4 w-4" /> Connected as {status.accountEmail}
                  <span className="text-slate-500">
                    · {status.syncing ? "syncing now…" : status.lastSyncedAt ? `synced ${timeAgo(status.lastSyncedAt)}` : "not synced yet"}
                  </span>
                </span>
              ) : status.configured ? (
                "Ready to connect."
              ) : (
                "Off. Add a Google OAuth client to .env to turn it on."
              )}
            </CardDescription>
          </div>
          {status?.configured ? (
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              {healthy ? (
                <Button size="sm" variant="outline" className="rounded-xl" onClick={() => void request("sync")} disabled={busy !== null || syncing}>
                  <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", syncing && "animate-spin")} />
                  {syncing ? "Syncing…" : "Sync now"}
                </Button>
              ) : (
                <Button size="sm" className="rounded-xl" onClick={() => void request("connect")} disabled={busy !== null}>
                  {busy === "connect" ? "Opening Google…" : status.needsReconnect ? "Reconnect Gmail" : "Connect Gmail"}
                </Button>
              )}
              {status.connected ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-xl text-slate-600"
                  onClick={() => {
                    if (window.confirm("Disconnect Gmail? FounderOS deletes its saved token and asks Google to revoke it.")) void request("disconnect");
                  }}
                  disabled={busy !== null}
                >
                  Disconnect
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {notice ? (
          <p className={cn("rounded-2xl border px-4 py-3", notice.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900")}>
            {notice.text}
          </p>
        ) : null}
        {status?.lastError && !notice ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">Last sync problem: {status.lastError}</p>
        ) : null}
        <p className="text-slate-600">
          Every {status?.intervalMinutes ?? 15} minutes FounderOS reads the <strong>headers</strong> of new mail (from, to, subject, time),
          never the message body, and moves each lead&apos;s last contact to the latest email either way. Drafts you&apos;ve already sent,
          or that the lead answered, close themselves. FounderOS still never sends email.
        </p>
        {status?.connected && status.lastSync && !status.syncing ? (
          <p className="text-xs text-muted-foreground">Last sync: {syncSummary(status.lastSync)}</p>
        ) : null}
        {status && !status.connected ? (
          <div className="rounded-2xl border border-border/60 bg-white/60 px-4 py-3">
            <p className="font-medium text-slate-900">{status.configured ? "Before you connect" : "Set it up (about 5 minutes)"}</p>
            {status.configured ? (
              <p className="mt-1 text-slate-600">Your Google OAuth client must list this authorized redirect URI:</p>
            ) : (
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-slate-600">
                <li>
                  In Google Cloud Console, enable the Gmail API and create an OAuth client of type <em>Web application</em>.
                </li>
                <li>Add this authorized redirect URI to the OAuth client:</li>
              </ol>
            )}
            <code className="mt-2 block break-all rounded-xl bg-slate-900 px-3 py-2 text-xs text-slate-100">{redirectUri}</code>
            {!status.configured ? (
              <p className="mt-2 text-slate-600">
                Then set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in <code>.env</code> and restart. Full steps are in
                the README under &quot;Gmail sync&quot;.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function McpCard({ mcp }: { mcp: NonNullable<ProvidersResponse["mcp"]> }) {
  const base = mcp.publicUrl ?? "https://your-public-host";
  const readTools = mcp.tools.filter((t) => !t.writes);
  const writeTools = mcp.tools.filter((t) => t.writes);

  return (
    <Card className="bg-card border-border/50">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
              mcp.enabled ? "border-emerald-400 bg-emerald-100" : "border-slate-300 bg-secondary",
            )}
          >
            <Plug className={cn("h-5 w-5", mcp.enabled ? "text-emerald-600" : "text-slate-600")} />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle>Connect ChatGPT or Claude (MCP)</CardTitle>
            <CardDescription className="mt-1">
              {mcp.enabled ? (
                <span className="flex items-center gap-1.5 text-emerald-700">
                  <CheckCircle className="h-4 w-4" /> MCP endpoint is on · {mcp.tools.length} tools
                </span>
              ) : (
                <span className="text-slate-600">{mcp.problem}</span>
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="rounded-2xl border border-border/60 bg-white/60 px-4 py-3">
          <p className="font-medium text-slate-900">ChatGPT</p>
          <p className="mt-1 text-slate-600">
            Settings → Apps &amp; Connectors → Advanced → Developer mode, then create a connector with this URL and
            authentication set to <em>No authentication</em>. The token in the URL is the credential.
          </p>
          <code className="mt-2 block break-all rounded-xl bg-slate-900 px-3 py-2 text-xs text-slate-100">
            {base}/mcp/&lt;MCP_TOKEN&gt;
          </code>
        </div>
        <div className="rounded-2xl border border-border/60 bg-white/60 px-4 py-3">
          <p className="font-medium text-slate-900">Claude Code, Claude Desktop, Cursor</p>
          <code className="mt-2 block break-all rounded-xl bg-slate-900 px-3 py-2 text-xs text-slate-100">
            claude mcp add --transport http founderos {base}/mcp --header "Authorization: Bearer &lt;MCP_TOKEN&gt;"
          </code>
        </div>
        <p className="text-xs text-muted-foreground">
          ChatGPT needs a public HTTPS address. Deploy FounderOS or run a tunnel such as{" "}
          <code>cloudflared tunnel --url http://localhost:5000</code>, and set <code>APP_URL</code> to that address.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {readTools.map((t) => (
            <Badge key={t.name} variant="secondary" className="border-slate-200 bg-white text-[10px] font-normal text-slate-700">
              {t.name}
            </Badge>
          ))}
          {writeTools.map((t) => (
            <Badge key={t.name} variant="secondary" className="border-amber-300 bg-amber-50 text-[10px] font-normal text-amber-800">
              {t.name} · writes
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
