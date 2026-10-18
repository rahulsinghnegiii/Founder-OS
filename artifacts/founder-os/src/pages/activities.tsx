import React, { useMemo } from "react";
import { Activity as ActivityIcon, AlertTriangle, ArrowUpRight, Bot, Compass, Workflow } from "lucide-react";
import { useListActivities } from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import { SectionHeading, StatusPill } from "@/components/hq/primitives";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getActivityTone, getToneClasses, summarizeActivity } from "@/lib/operations";

function getActivityIcon(entityType?: string | null) {
  switch (entityType) {
    case "workflow":
      return Workflow;
    case "opportunity":
      return Compass;
    case "lead":
      return ArrowUpRight;
    default:
      return ActivityIcon;
  }
}

function prettifyToken(value?: string | null) {
  if (!value) return "System";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function eventTitle(activity: { entityType?: string | null; action?: string | null; summary?: string }) {
  const entity = prettifyToken(activity.entityType);
  const action = prettifyToken(activity.action);
  if (entity !== "System" && action !== "System") return `${entity} ${action}`;
  if (action !== "System") return action;
  return activity.summary ?? "System event";
}

const HIDDEN_DETAIL_KEYS = new Set([
  "id",
  "entityType",
  "action",
  "actorName",
  "actorType",
  "createdAt",
  "updatedAt",
  "timestamp",
]);

function buildDetailRows(activity: { details?: Record<string, unknown> | null }) {
  const rows: { label: string; value: string }[] = [];
  const details = activity.details;
  if (details && typeof details === "object") {
    for (const [key, value] of Object.entries(details)) {
      if (HIDDEN_DETAIL_KEYS.has(key)) continue;
      const display = typeof value === "object" ? JSON.stringify(value) : String(value);
      if (!display) continue;
      rows.push({ label: prettifyToken(key), value: display });
      if (rows.length >= 4) break;
    }
  }
  return rows;
}

export default function Activities() {
  const { data: activitiesData, isLoading } = useListActivities(
    { limit: 50 },
    { query: { refetchInterval: 20000 } },
  );

  const activities = Array.isArray(activitiesData) ? activitiesData : [];

  const enhanced = useMemo(
    () =>
      activities.map((activity) => {
        const tone = getActivityTone(activity);
        return {
          ...activity,
          tone,
          summary: summarizeActivity(activity),
        };
      }),
    [activities],
  );

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Activity System"
        title="Operational feed"
        description="A living stream of typed events across strategy, execution, workflows, opportunities, and founder coordination."
        action={<StatusPill label="Feed" value={isLoading ? "Syncing" : "Realtime cadence"} tone={isLoading ? "attention" : "active"} />}
      />

      <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="hq-panel bg-white/90">
          <CardHeader className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Feed structure</p>
            <CardTitle className="font-display text-3xl tracking-[-0.05em]">Typed operational events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: "Strategic events", copy: "Routing, planning, founder coordination, and executive signal.", icon: Bot, tone: "bg-sky-100/75" },
              { label: "Lead events", copy: "Qualification, outreach, follow-ups, proposal movement, and pipeline changes.", icon: ArrowUpRight, tone: "bg-rose-100/75" },
              { label: "Execution events", copy: "Tasks, projects, completion state, and operational movement.", icon: ActivityIcon, tone: "bg-amber-100/75" },
              { label: "Workflow events", copy: "Automation triggers, background actions, and system movement.", icon: Workflow, tone: "bg-emerald-100/75" },
            ].map((item) => (
              <div key={item.label} className={`rounded-[1.5rem] border border-border p-4 shadow-sm ${item.tone}`}>
                <div className="mb-2 flex items-center gap-3">
                  <div className="rounded-2xl border border-border bg-white p-2.5">
                    <item.icon className="h-4 w-4 text-slate-800" />
                  </div>
                  <p className="font-semibold text-slate-900">{item.label}</p>
                </div>
                <p className="text-sm leading-6 text-slate-700">{item.copy}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="hq-panel bg-white/90">
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Live pulse</p>
                <CardTitle className="font-display text-3xl tracking-[-0.05em]">Command floor timeline</CardTitle>
              </div>
              <StatusPill label="Events" value={`${enhanced.length}`} tone="calm" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {isLoading
                ? Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-[1.6rem]" />)
                : enhanced.map((activity) => {
                    const Icon = getActivityIcon(activity.entityType);
                    const actorLabel = activity.actorName || activity.actorType || "FounderOS";
                    const ageLabel = formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true });
                    const title = eventTitle(activity);
                    const detailRows = buildDetailRows(activity);

                    return (
                      <div key={activity.id} className="rounded-[1.6rem] border border-border bg-white/85 p-4 shadow-sm">
                        <div className="flex items-start gap-4">
                          <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[1.1rem] border ${getToneClasses(activity.tone)}`}>
                            {activity.tone === "critical" ? (
                              <AlertTriangle className="h-4 w-4" />
                            ) : (
                              <Icon className="h-4 w-4" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <p className="font-display text-lg font-bold leading-snug tracking-[-0.02em] text-slate-900">
                                {title}
                              </p>
                              <Badge className={`shrink-0 border ${getToneClasses(activity.tone)}`}>{activity.tone}</Badge>
                            </div>
                            <p className="mt-0.5 text-sm text-muted-foreground">Created by {actorLabel}</p>
                            {detailRows.length > 0 ? (
                              <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                                {detailRows.map((row) => (
                                  <div key={row.label} className="flex items-baseline gap-2 text-sm">
                                    <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                      {row.label}
                                    </span>
                                    <span className="truncate font-medium text-slate-800">{row.value}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            <p className="mt-2 text-xs text-muted-foreground/80">{ageLabel}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="hq-panel bg-white/90">
        <CardHeader className="flex flex-row items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Signal discipline</p>
            <CardTitle className="font-display text-3xl tracking-[-0.05em]">How to read the feed</CardTitle>
          </div>
          <AlertTriangle className="h-5 w-5 text-amber-500" />
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-[1.4rem] border border-border bg-rose-50/80 p-4 shadow-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-rose-950">Critical</p>
            <p className="text-sm leading-6 text-slate-700">Needs founder attention, escalation, or immediate routing.</p>
          </div>
          <div className="rounded-[1.4rem] border border-border bg-amber-50/80 p-4 shadow-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-amber-950">Attention</p>
            <p className="text-sm leading-6 text-slate-700">Represents momentum, decision points, or shifting operational state.</p>
          </div>
          <div className="rounded-[1.4rem] border border-border bg-emerald-50/80 p-4 shadow-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-950">Active</p>
            <p className="text-sm leading-6 text-slate-700">Healthy motion across the organization and routine execution progress.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
