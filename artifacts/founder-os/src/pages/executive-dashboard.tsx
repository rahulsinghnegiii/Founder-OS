"use client";

import {
  AlertCircle,
  ArrowRight,
  Calendar,
  CheckSquare,
  Lightbulb,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { useGetDailyBriefing, useGetDashboardSummary } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { fetcher } from "@/lib/fetcher";

type SalesOverview = {
  pipeline: { openCount: number; openValue: number; wonCount: number; wonValue: number };
  staleDeals: Array<{
    lead: { id: string; name: string; company: string | null; estimatedValue: number | null };
    stageLabel: string;
    daysSilent: number;
    severity: "at_risk" | "critical";
  }>;
  followUps: Array<{ id: string; leadName: string; subject: string }>;
  brief: { summary: string; actions: string[]; risks: string[]; atRiskValue: number };
};

function money(value: number | null | undefined): string {
  const n = value ?? 0;
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}
import { SectionHeading, StatusPill } from "@/components/hq/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function getPriorityColor(priority: string) {
  switch (priority) {
    case "critical":
      return "bg-rose-500 text-rose-50";
    case "high":
      return "bg-amber-500 text-amber-50";
    case "medium":
      return "bg-sky-500 text-sky-50";
    default:
      return "bg-slate-500 text-slate-50";
  }
}

function getPriorityBg(priority: string) {
  switch (priority) {
    case "critical":
      return "bg-rose-50 border-rose-200";
    case "high":
      return "bg-amber-50 border-amber-200";
    case "medium":
      return "bg-sky-50 border-sky-200";
    default:
      return "bg-slate-50 border-slate-200";
  }
}

function SectionCard({
  title,
  icon: Icon,
  items,
  priority = "medium",
  emptyMessage = "Nothing to report.",
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  items: string[];
  priority?: "critical" | "high" | "medium" | "low";
  emptyMessage?: string;
}) {
  const priorityColor = getPriorityColor(priority);
  const bgClass = getPriorityBg(priority);

  if (!items.length) {
    return (
      <Card className={`hq-panel ${bgClass} border-2 border-border`}>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${priorityColor}`}>
              <Icon className="h-5 w-5" />
            </div>
            <CardTitle className="font-display text-xl font-bold">{title}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="py-6">
          <p className="text-center text-muted-foreground">{emptyMessage}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`hq-panel ${bgClass} border-2 border-border`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${priorityColor}`}>
              <Icon className="h-5 w-5" />
            </div>
            <CardTitle className="font-display text-xl font-bold">{title}</CardTitle>
          </div>
          <Badge variant="outline" className={`rounded-full ${priorityColor} text-xs`}>
            {priority.toUpperCase()}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-3 rounded-xl border border-border bg-white/80 p-4 shadow-sm transition-all hover:shadow-md">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-mono font-bold">
                {i + 1}
              </span>
              <p className="flex-1 text-sm leading-relaxed text-slate-800">{item}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  iconColor = "text-sky-500",
  bgColor = "bg-sky-50/75",
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor?: string;
  bgColor?: string;
}) {
  return (
    <Card className={`metric-panel ${bgColor}`}>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {label}
            </p>
            <p className="font-display text-4xl font-bold tracking-tight">{value}</p>
            <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/80 shadow-sm">
            <Icon className={`h-6 w-6 ${iconColor}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ExecutiveDashboard() {
  const { data: briefing, isLoading: briefingLoading } = useGetDailyBriefing();
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary();
  const { data: sales } = useQuery({
    queryKey: ["sales", "overview"],
    queryFn: () => fetcher<SalesOverview>("/api/sales/overview"),
    refetchInterval: 60_000,
  });

  const isLoading = briefingLoading || summaryLoading;
  const staleDeals = sales?.staleDeals ?? [];
  const followUps = sales?.followUps ?? [];
  const staleItems = staleDeals.map(
    (d) => `${d.lead.name}${d.lead.company ? ` (${d.lead.company})` : ""} — ${d.daysSilent} days silent in ${d.stageLabel}, ${money(d.lead.estimatedValue)}`,
  );
  const followUpItems = followUps.map((f) => `${f.leadName}: "${f.subject}"`);
  const focus = sales?.brief.actions?.[0] ?? briefing?.suggestedFocus;

  if (isLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-12 w-64 rounded-lg" />
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-72 rounded-[2rem]" />
          <Skeleton className="h-72 rounded-[2rem]" />
          <Skeleton className="h-72 rounded-[2rem]" />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-[2rem]" />
          <Skeleton className="h-72 rounded-[2rem]" />
        </div>
      </div>
    );
  }

  const urgentAlerts = summary?.urgentAlerts ?? 0;
  const healthTone = urgentAlerts > 0 ? "attention" : "active";
  const healthLabel = urgentAlerts > 0 ? `${urgentAlerts} alert(s) need attention` : "All clear";

  return (
    <div className="space-y-6">
      {/* Header */}
      <SectionHeading
        eyebrow="Daily Executive Briefing"
        title={briefing?.date ?? "Today's Briefing"}
        description={sales?.brief.summary ?? briefing?.summary ?? "Your Sales agent is watching the pipeline and will brief you here."}
        action={
          <div className="flex items-center gap-3">
            <StatusPill label="Briefing" value={briefing?.date ? "Ready" : "Today"} tone="calm" />
            <StatusPill label="Health" value={healthLabel} tone={healthTone} />
          </div>
        }
      />

      {/* Suggested Focus - Hero Card */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="relative overflow-hidden"
      >
        <Card className="hq-panel relative overflow-hidden border-2 border-zinc-950 bg-zinc-950 text-white shadow-[12px_12px_0px_var(--shadow-ink)]">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-transparent" />
          <CardContent className="relative p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-zinc-950">
                <Target className="h-6 w-6" />
              </div>
              <div>
                <h2 className="font-display text-3xl font-bold tracking-tight">Today's Focus</h2>
                <p className="text-sm text-zinc-400">Your single highest-leverage move</p>
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
              <p className="font-display text-2xl leading-relaxed text-zinc-100">
                {focus ?? "No specific focus has been set for today. Open the EA Desk to align on priorities."}
              </p>
            </div>
            <div className="flex flex-wrap gap-4">
              <Button asChild className="rounded-2xl bg-primary px-8 py-4 text-lg font-bold text-zinc-950 hover:bg-primary/90">
                <Link href="/sales">Open Sales Desk <span className="ml-2">→</span></Link>
              </Button>
              <Button asChild variant="outline" className="rounded-2xl border-zinc-800 bg-transparent px-8 py-4 text-lg font-bold text-zinc-300 hover:bg-zinc-900">
                <Link href="/chat">Open EA Desk</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.section>

      {/* Main Grid - Priority Sections */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
      >
        <SectionCard
          title="Deals going quiet"
          icon={AlertCircle}
          items={staleItems}
          priority={staleDeals.some((d) => d.severity === "critical") ? "critical" : "high"}
          emptyMessage="Every open deal has been touched recently."
        />
        <SectionCard
          title="Follow-ups ready to send"
          icon={Users}
          items={followUpItems}
          priority="medium"
          emptyMessage="No drafts waiting. Alex writes one when a deal goes quiet."
        />
        <SectionCard
          title="Today's sales moves"
          icon={Target}
          items={sales?.brief.actions ?? []}
          priority="medium"
          emptyMessage="Add a lead and the Sales agent will start planning your day."
        />
        <SectionCard
          title="Sales risks"
          icon={Lightbulb}
          items={sales?.brief.risks ?? []}
          priority="low"
          emptyMessage="No risks flagged."
        />
        <SectionCard
          title="Upcoming deadlines"
          icon={Calendar}
          items={briefing?.alerts ?? []}
          priority="low"
          emptyMessage="No deadline alerts."
        />
      </motion.section>

      {/* Business Health — calculated from live DashboardSummary */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut", delay: 0.2 }}
        className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]"
      >
        <Card className="hq-panel border-2 border-border">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-sky-100 text-sky-600">
                <TrendingUp className="h-5 w-5" />
              </div>
              <CardTitle className="font-display text-xl font-bold">Business Health</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <MetricCard
              label="Active initiatives"
              value={summary?.activeProjects ?? 0}
              detail="Projects in motion"
              icon={Target}
              iconColor="text-indigo-500"
              bgColor="bg-indigo-50/75"
            />
            <MetricCard
              label="Open tasks"
              value={summary?.openTasks ?? 0}
              detail="Execution load"
              icon={CheckSquare}
              iconColor="text-sky-600"
              bgColor="bg-sky-50/75"
            />
            <MetricCard
              label="Open pipeline"
              value={money(sales?.pipeline.openValue)}
              detail={`${sales?.pipeline.openCount ?? summary?.totalLeads ?? 0} active deals`}
              icon={Users}
              iconColor="text-rose-500"
              bgColor="bg-rose-50/75"
            />
            <MetricCard
              label="At risk"
              value={money(sales?.brief.atRiskValue)}
              detail={`${staleDeals.length} deal${staleDeals.length === 1 ? "" : "s"} gone quiet`}
              icon={TrendingUp}
              iconColor="text-amber-600"
              bgColor="bg-amber-50/75"
            />
          </CardContent>
        </Card>

        <Card className="hq-panel border-2 border-zinc-950 bg-zinc-50 shadow-[8px_8px_0px_var(--shadow-ink)]">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-zinc-100 text-zinc-950">
                <Zap className="h-5 w-5" />
              </div>
              <CardTitle className="font-display text-xl font-bold">Pipeline pulse</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="rounded-2xl border-2 border-zinc-950 bg-white p-6 shadow-[4px_4px_0px_var(--shadow-ink)]">
              <p className="font-display text-xl leading-relaxed text-zinc-950">
                {sales?.brief.summary ?? briefing?.summary ?? "Add a lead and the Sales agent will start watching your pipeline."}
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button asChild className="flex-1 rounded-2xl bg-zinc-950 px-6 py-3 text-white hover:bg-zinc-900">
                <Link href="/sales">Open Sales Desk</Link>
              </Button>
              <Button asChild variant="outline" className="rounded-2xl px-6 py-3">
                <Link href="/leads">View Leads</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.section>
    </div>
  );
}
