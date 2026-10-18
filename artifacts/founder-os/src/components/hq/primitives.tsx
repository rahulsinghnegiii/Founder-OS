import React from "react";
import { BellRing, Bot, Brain, ChevronDown, Sparkles, Workflow } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Activity, Agent, Notification, Workflow as WorkflowType } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { summarizeActivity } from "@/lib/operations";

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="space-y-1.5">
        {eyebrow ? (
          <div className="inline-flex rounded-full border border-border bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-muted-foreground shadow-sm">
            {eyebrow}
          </div>
        ) : null}
        <div className="space-y-1">
          <h1 className="font-display text-3xl font-bold tracking-[-0.05em] text-foreground md:text-5xl">
            {title}
          </h1>
          {description ? (
            <p className="max-w-2xl text-sm text-muted-foreground md:text-base">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function StatusPill({
  label,
  value,
  tone = "calm",
}: {
  label: string;
  value: string;
  tone?: "calm" | "active" | "attention" | "critical";
}) {
  const toneClasses =
    tone === "critical"
      ? "bg-rose-100 text-rose-950 border-rose-300"
      : tone === "attention"
        ? "bg-amber-100 text-amber-950 border-amber-300"
        : tone === "active"
          ? "bg-emerald-100 text-emerald-950 border-emerald-300"
          : "bg-white text-slate-700 border-slate-300";

  return (
    <div className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm", toneClasses)}>
      <span className="pulse-dot" />
      <span className="uppercase tracking-[0.18em] text-[10px] opacity-70">{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function MetricPanel({
  label,
  value,
  detail,
  accentClass,
  icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  accentClass?: string;
  icon?: React.ReactNode;
}) {
  return (
    <Card className={cn("hq-panel overflow-hidden h-full", accentClass)}>
      <CardContent className="flex h-full flex-col overflow-hidden p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {label}
          </p>
          {icon ? (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-white/75">
              {icon}
            </div>
          ) : null}
        </div>
        <p className="mt-3 break-words font-display text-5xl font-bold leading-none tracking-[-0.05em]">{value}</p>
        <p className="mt-1.5 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[1.75rem] border border-dashed border-border bg-white/70 px-6 py-10 text-center shadow-sm">
      {Icon ? (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-white/80 shadow-sm">
          <Icon className="h-6 w-6 text-muted-foreground/70" />
        </div>
      ) : null}
      <p className="font-display text-xl font-bold tracking-[-0.05em] text-slate-900">{title}</p>
      {description ? (
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

function RailSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="group/section">
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-2xl px-1 py-1 text-left">
        <span className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          {title}
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=closed]/section:-rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function RailStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-white/85 px-4 py-3 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

/**
 * ContextRail — the third column. Content-only so it can render inline
 * (desktop >=1440px) or inside a drawer (below 1440px). Shows a live,
 * contextual view of the assistant's current state.
 */
export function ContextRail({
  notifications,
  agents,
  isWorking = false,
  activities = [],
  workflows = [],
  plans = [],
}: {
  notifications: Notification[];
  agents: Agent[];
  isWorking?: boolean;
  activities?: Activity[];
  workflows?: WorkflowType[];
  plans?: { id: string; goal: string }[];
}) {
  const activeAgents = agents.filter(
    (agent) => agent.status === "active" || agent.status === "busy",
  ).length;
  const urgentNotifications = notifications.filter(
    (notification) => notification.priority === "urgent",
  );
  const unreadCount = notifications.length;

  const objective = plans[0]?.goal;
  const liveWorkflow = workflows.find((workflow) => workflow.isActive) ?? workflows[0];
  const lastAction = activities[0];
  const focusItems = notifications.slice(0, 3).map((notification) => notification.title);

  const summary =
    unreadCount > 0
      ? `${unreadCount} unread signal${unreadCount === 1 ? "" : "s"}${
          urgentNotifications.length ? `, ${urgentNotifications.length} urgent` : ""
        }. ${activeAgents} agent${activeAgents === 1 ? "" : "s"} active.`
      : `${activeAgents} agent${activeAgents === 1 ? "" : "s"} active and the signal queue is clear.`;

  return (
    <div className="flex flex-col gap-5">
      {/* Assistant status — always visible */}
      <Card className="hq-panel relative overflow-hidden bg-white/90">
        <div className="assistant-aura pointer-events-none absolute inset-x-6 top-4 h-20 rounded-full opacity-80" />
        <CardHeader className="relative space-y-4 pb-4">
          <div className="flex items-center justify-between">
            <Badge className="rounded-full border-zinc-950 bg-zinc-950 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-white">
              Assistant
            </Badge>
            <StatusPill
              label="Presence"
              value={isWorking ? "Reasoning" : "Online"}
              tone={isWorking ? "attention" : "active"}
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[1.4rem] border-2 border-border bg-rose-300 shadow-[5px_5px_0px_var(--shadow-ink)]">
              <Bot className="h-7 w-7 text-zinc-950" />
            </div>
            <div className="min-w-0">
              <CardTitle className="font-display text-xl tracking-[-0.05em]">Executive Assistant</CardTitle>
              <p className="text-sm text-muted-foreground">Persistent founder support.</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="relative space-y-4">
          <p className="rounded-[1.4rem] border border-border bg-white/80 p-4 text-sm leading-6 text-slate-700 shadow-sm">
            {summary}
          </p>
        </CardContent>
      </Card>

      {/* Live state — dynamic, contextual */}
      <Card className="hq-panel bg-white/90">
        <CardContent className="p-5">
          <RailSection title="Live state">
            <div className="grid grid-cols-2 gap-3">
              <RailStat
                label="Current objective"
                value={objective ? objective : "Align in EA Desk"}
              />
              <RailStat
                label="Thinking"
                value={isWorking ? "Active reasoning" : "Idle"}
              />
              <RailStat
                label="Memory"
                value={`${agents.length} agent${agents.length === 1 ? "" : "s"}`}
              />
              <RailStat
                label="Workflow"
                value={liveWorkflow ? liveWorkflow.name : "No active flow"}
              />
            </div>
            <div className="mt-3 rounded-2xl border border-border bg-white/85 px-4 py-3 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Last completed action
              </p>
              <p className="mt-0.5 truncate text-sm font-medium text-slate-900">
                {lastAction ? summarizeActivity(lastAction) : "Awaiting first signal"}
              </p>
            </div>
            <Button
              asChild
              className="mt-3 w-full rounded-2xl bg-zinc-950 text-white shadow-[5px_5px_0px_var(--shadow-ink)] hover:bg-zinc-900"
            >
              <Link href="/chat">
                <Brain className="mr-2 h-4 w-4" /> Open EA Desk
              </Link>
            </Button>
          </RailSection>
        </CardContent>
      </Card>

      {/* Today's focus — real unread signals */}
      <Card className="hq-panel bg-white/90">
        <CardContent className="p-5">
          <RailSection title="Today's focus">
            <div className="space-y-2">
              {focusItems.length > 0 ? (
                focusItems.map((focus) => (
                  <div
                    key={focus}
                    className="rounded-2xl border border-border bg-white/85 px-4 py-3 text-sm leading-6 text-slate-700 shadow-sm"
                  >
                    {focus}
                  </div>
                ))
              ) : (
                <p className="rounded-2xl border border-dashed border-border bg-white/80 px-4 py-3 text-sm text-muted-foreground">
                  No urgent signals — your floor is clear.
                </p>
              )}
            </div>
          </RailSection>
        </CardContent>
      </Card>

      {/* Alerts */}
      <Card className="hq-panel bg-white/90">
        <CardContent className="p-5">
          <RailSection title="Alerts">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-border bg-amber-100/70 p-4 shadow-sm">
                <div className="mb-2 flex items-center gap-2 text-amber-950">
                  <BellRing className="h-4 w-4" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">Unread</span>
                </div>
                <p className="font-display text-3xl font-bold tracking-[-0.05em] text-zinc-950">
                  {unreadCount}
                </p>
              </div>
              <div className="rounded-2xl border border-border bg-sky-100/70 p-4 shadow-sm">
                <div className="mb-2 flex items-center gap-2 text-sky-950">
                  <Sparkles className="h-4 w-4" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">Awake</span>
                </div>
                <p className="font-display text-3xl font-bold tracking-[-0.05em] text-zinc-950">
                  {activeAgents}
                </p>
              </div>
            </div>
          </RailSection>
        </CardContent>
      </Card>
    </div>
  );
}
