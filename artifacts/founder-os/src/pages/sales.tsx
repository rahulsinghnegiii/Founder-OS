import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  Check,
  Clock3,
  Copy,
  DollarSign,
  Flame,
  Mail,
  PenLine,
  RefreshCw,
  ScanSearch,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { EmptyState, MetricPanel, SectionHeading, StatusPill } from "@/components/hq/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Lead = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  status: string;
  score: number;
  estimatedValue: number | null;
  lastContactedAt: string | null;
};

type StaleDeal = {
  lead: Lead;
  stage: string;
  stageLabel: string;
  daysSilent: number;
  threshold: number;
  severity: "at_risk" | "critical";
  openDraftId: string | null;
};

type FollowUp = {
  id: string;
  leadId: string;
  leadName: string;
  leadCompany: string | null;
  leadEmail: string | null;
  leadStatus: string;
  reason: string;
  subject: string;
  body: string;
  status: string;
  daysSilent: number;
  createdAt: string;
};

type Overview = {
  pipeline: {
    stages: Array<{ status: string; label: string; count: number; value: number }>;
    openCount: number;
    openValue: number;
    wonCount: number;
    wonValue: number;
    lostCount: number;
  };
  staleDeals: StaleDeal[];
  followUps: FollowUp[];
  brief: {
    generatedAt: string;
    summary: string;
    actions: string[];
    risks: string[];
    openValue: number;
    atRiskValue: number;
    atRiskCount: number;
    cached: boolean;
  };
};

const OVERVIEW_KEY = ["sales", "overview"] as const;

function money(value: number | null | undefined): string {
  const n = value ?? 0;
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function post<T>(url: string): Promise<T> {
  return fetcher<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
}

export default function SalesDesk() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: OVERVIEW_KEY,
    queryFn: () => fetcher<Overview>("/api/sales/overview"),
    refetchInterval: 30_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: OVERVIEW_KEY });
    void queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").includes("/api/") });
  };

  const scan = useMutation({
    mutationFn: () => post<{ scanned: number; stale: number; drafted: number }>("/api/sales/scan"),
    onSuccess: (result) => {
      toast({
        title: "Pipeline scanned",
        description: `${result.scanned} open deals checked, ${result.stale} quiet, ${result.drafted} new draft${result.drafted === 1 ? "" : "s"} written.`,
      });
      invalidate();
    },
    onError: () => toast({ title: "Scan failed", variant: "destructive" }),
  });

  const draftFor = useMutation({
    mutationFn: (leadId: string) => post<FollowUp>(`/api/sales/leads/${leadId}/draft`),
    onSuccess: () => {
      toast({ title: "Follow-up drafted", description: "It's in the queue below." });
      invalidate();
    },
    onError: () => toast({ title: "Couldn't draft follow-up", variant: "destructive" }),
  });

  const logContact = useMutation({
    mutationFn: (leadId: string) => post<Lead>(`/api/sales/leads/${leadId}/contact`),
    onSuccess: () => {
      toast({ title: "Contact logged", description: "The silence clock has been reset for this deal." });
      invalidate();
    },
  });

  const markSent = useMutation({
    mutationFn: (id: string) => post<FollowUp>(`/api/sales/follow-ups/${id}/sent`),
    onSuccess: () => {
      toast({ title: "Marked as sent", description: "Lead updated and last contact set to now." });
      invalidate();
    },
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => post<FollowUp>(`/api/sales/follow-ups/${id}/dismiss`),
    onSuccess: invalidate,
  });

  const regenerate = useMutation({
    mutationFn: (id: string) => post<FollowUp>(`/api/sales/follow-ups/${id}/regenerate`),
    onSuccess: () => {
      toast({ title: "Draft rewritten" });
      invalidate();
    },
  });

  const copyDraft = async (followUp: FollowUp) => {
    try {
      await navigator.clipboard.writeText(`Subject: ${followUp.subject}\n\n${followUp.body}`);
      setCopiedId(followUp.id);
      setTimeout(() => setCopiedId((c) => (c === followUp.id ? null : c)), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Select the text and copy it manually.", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-28 w-full rounded-[2rem]" />
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-[2rem]" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-80 rounded-[2rem]" />
          <Skeleton className="h-80 rounded-[2rem]" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Sales Desk is unreachable"
        description="The API did not respond. Check that the server is running and try again."
        action={<Button onClick={() => refetch()}>Retry</Button>}
      />
    );
  }

  const { pipeline, staleDeals, followUps, brief } = data;
  const criticalCount = staleDeals.filter((d) => d.severity === "critical").length;
  const healthTone = criticalCount > 0 ? "critical" : staleDeals.length > 0 ? "attention" : "active";
  const healthLabel = criticalCount > 0 ? `${criticalCount} cooling off` : staleDeals.length > 0 ? `${staleDeals.length} going quiet` : "Healthy";

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Sales department · Alex"
        title="Sales Desk"
        description={brief.summary}
        action={
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill label="Pipeline" value={healthLabel} tone={healthTone} />
            <Button
              onClick={() => scan.mutate()}
              disabled={scan.isPending}
              className="rounded-2xl bg-zinc-950 text-white shadow-[5px_5px_0px_var(--shadow-ink)] hover:bg-zinc-900"
            >
              <ScanSearch className={cn("mr-2 h-4 w-4", scan.isPending && "animate-spin")} />
              {scan.isPending ? "Scanning…" : "Scan pipeline now"}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <MetricPanel
          label="Open pipeline"
          value={money(pipeline.openValue)}
          detail={`${pipeline.openCount} active deal${pipeline.openCount === 1 ? "" : "s"}`}
          accentClass="bg-sky-50/80"
          icon={<DollarSign className="h-4 w-4 text-sky-600" />}
        />
        <MetricPanel
          label="At risk"
          value={money(brief.atRiskValue)}
          detail={`${staleDeals.length} deal${staleDeals.length === 1 ? "" : "s"} gone quiet`}
          accentClass={staleDeals.length ? "bg-amber-50/80" : "bg-emerald-50/80"}
          icon={<Flame className={cn("h-4 w-4", staleDeals.length ? "text-amber-600" : "text-emerald-600")} />}
        />
        <MetricPanel
          label="Drafts ready"
          value={followUps.length}
          detail="Follow-ups waiting for you"
          accentClass="bg-rose-50/80"
          icon={<Mail className="h-4 w-4 text-rose-600" />}
        />
        <MetricPanel
          label="Won"
          value={money(pipeline.wonValue)}
          detail={`${pipeline.wonCount} closed · ${pipeline.lostCount} lost`}
          accentClass="bg-emerald-50/80"
          icon={<Trophy className="h-4 w-4 text-emerald-600" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="hq-panel bg-white/90">
          <CardHeader className="border-b border-border/70 pb-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-slate-700" />
                <CardTitle className="font-display text-2xl tracking-[-0.05em]">Deals going quiet</CardTitle>
              </div>
              <Badge className="border-border bg-white/85 text-slate-900">{staleDeals.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-5">
            {staleDeals.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-white/85 px-4 py-6 text-center text-sm text-muted-foreground">
                {pipeline.openCount === 0
                  ? "No open deals yet. Add a lead and Alex will start watching it."
                  : "Every open deal has been touched recently. Nothing to chase."}
              </div>
            ) : (
              staleDeals.map((deal) => (
                <div
                  key={deal.lead.id}
                  className={cn(
                    "rounded-2xl border px-4 py-3 shadow-sm",
                    deal.severity === "critical" ? "border-rose-300 bg-rose-50/80" : "border-amber-300 bg-amber-50/70",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/leads/${deal.lead.id}`} className="font-semibold text-slate-900 hover:underline">
                        {deal.lead.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {deal.lead.company ?? "No company"} · {deal.stageLabel} · {money(deal.lead.estimatedValue)}
                      </p>
                    </div>
                    <Badge
                      className={cn(
                        "border",
                        deal.severity === "critical" ? "border-rose-400 bg-rose-100 text-rose-950" : "border-amber-400 bg-amber-100 text-amber-950",
                      )}
                    >
                      {deal.daysSilent}d silent · limit {deal.threshold}d
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {deal.openDraftId ? (
                      <Button asChild size="sm" variant="outline" className="rounded-xl">
                        <a href={`#followup-${deal.openDraftId}`}>
                          <Mail className="mr-1.5 h-3.5 w-3.5" /> View draft
                        </a>
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="rounded-xl bg-zinc-950 text-white hover:bg-zinc-900"
                        disabled={draftFor.isPending}
                        onClick={() => draftFor.mutate(deal.lead.id)}
                      >
                        <PenLine className="mr-1.5 h-3.5 w-3.5" /> Draft follow-up
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl"
                      disabled={logContact.isPending}
                      onClick={() => logContact.mutate(deal.lead.id)}
                    >
                      <Check className="mr-1.5 h-3.5 w-3.5" /> I reached out
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="hq-panel border-2 border-zinc-950 bg-zinc-950 text-white shadow-[10px_10px_0px_var(--shadow-ink)]">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-300" />
                <CardTitle className="font-display text-2xl tracking-[-0.05em]">Today's sales moves</CardTitle>
              </div>
              <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-400">{brief.cached ? "Cached" : "Fresh"}</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="space-y-2">
              {brief.actions.map((action, i) => (
                <li key={i} className="flex gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-3 text-sm leading-6 text-zinc-100">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-300 font-mono text-xs font-bold text-zinc-950">
                    {i + 1}
                  </span>
                  <span>{action}</span>
                </li>
              ))}
            </ol>
            {brief.risks.length > 0 ? (
              <div className="rounded-2xl border border-rose-900/60 bg-rose-950/40 px-4 py-3">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-rose-300">Risks</p>
                <ul className="space-y-1 text-sm text-rose-100">
                  {brief.risks.map((risk, i) => (
                    <li key={i}>• {risk}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="grid grid-cols-3 gap-2 pt-1">
              {pipeline.stages
                .filter((s) => !["won", "lost"].includes(s.status))
                .map((stage) => (
                  <div key={stage.status} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                    <p className="truncate text-[10px] uppercase tracking-[0.18em] text-zinc-400">{stage.label}</p>
                    <p className="font-display text-xl font-bold">{stage.count}</p>
                    <p className="text-[11px] text-zinc-400">{money(stage.value)}</p>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="hq-panel bg-white/90">
        <CardHeader className="border-b border-border/70 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-slate-700" />
              <CardTitle className="font-display text-2xl tracking-[-0.05em]">Follow-up drafts</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground">Copy, send from your inbox, then mark it sent.</p>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 p-5 lg:grid-cols-2">
          {followUps.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-white/85 px-4 py-6 text-center text-sm text-muted-foreground lg:col-span-2">
              No drafts waiting. Alex writes one whenever a deal goes quiet, or ask for one from a lead's page.
            </div>
          ) : (
            followUps.map((followUp) => (
              <div
                key={followUp.id}
                id={`followup-${followUp.id}`}
                className="flex flex-col gap-3 rounded-[1.5rem] border border-border bg-white/90 p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/leads/${followUp.leadId}`} className="font-semibold text-slate-900 hover:underline">
                      {followUp.leadName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {followUp.leadCompany ?? "No company"}
                      {followUp.leadEmail ? ` · ${followUp.leadEmail}` : ""}
                    </p>
                  </div>
                  <Badge className="border-border bg-amber-100 text-amber-950">{followUp.reason}</Badge>
                </div>
                <div className="rounded-2xl border border-border bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">Subject: {followUp.subject}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{followUp.body}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="rounded-xl" onClick={() => copyDraft(followUp)}>
                    {copiedId === followUp.id ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
                    {copiedId === followUp.id ? "Copied" : "Copy"}
                  </Button>
                  <Button
                    size="sm"
                    className="rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
                    disabled={markSent.isPending}
                    onClick={() => markSent.mutate(followUp.id)}
                  >
                    <Check className="mr-1.5 h-3.5 w-3.5" /> Mark sent
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    disabled={regenerate.isPending}
                    onClick={() => regenerate.mutate(followUp.id)}
                  >
                    <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", regenerate.isPending && "animate-spin")} /> Rewrite
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="rounded-xl text-muted-foreground"
                    disabled={dismiss.isPending}
                    onClick={() => dismiss.mutate(followUp.id)}
                  >
                    <X className="mr-1.5 h-3.5 w-3.5" /> Dismiss
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
