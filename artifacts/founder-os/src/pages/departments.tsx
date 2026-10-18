import React, { useMemo } from "react";
import { Bot, Clock3, Construction, LineChart, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useListActivities, useListAgents, useListDepartments } from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import { SectionHeading, StatusPill } from "@/components/hq/primitives";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getActivityTone,
  getHealthLabel,
  getToneClasses,
  summarizeActivity,
} from "@/lib/operations";

export default function Departments() {
  const { data: departmentsData, isLoading: departmentsLoading } = useListDepartments();
  const { data: agentsData, isLoading: agentsLoading } = useListAgents();
  const { data: activitiesData, isLoading: activitiesLoading } = useListActivities(
    { limit: 40 },
    { query: { refetchInterval: 20000 } },
  );

  const departments = Array.isArray(departmentsData) ? departmentsData : [];
  const agents = Array.isArray(agentsData) ? agentsData : [];
  const activities = Array.isArray(activitiesData) ? activitiesData : [];

  const DEPARTMENT_ORDER = ["sales", "executive-assistant", "marketing", "operations", "strategy"];
  const departmentCards = useMemo(() => {
    const ordered = [...departments].sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      const ai = DEPARTMENT_ORDER.indexOf(a.slug);
      const bi = DEPARTMENT_ORDER.indexOf(b.slug);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    return ordered.map((department) => {
      const departmentAgents = agents.filter((agent) => agent.departmentId === department.id);
      const awakeAgents = departmentAgents.filter(
        (agent) => agent.status === "active" || agent.status === "busy",
      );
      const departmentActivity = activities
        .filter((activity) =>
          activity.details && typeof activity.details === "object"
            ? (activity.details as Record<string, unknown>).departmentId === department.id
            : false,
        )
        .slice(0, 3)
        .map((activity) => ({
          ...activity,
          tone: getActivityTone(activity),
          summary: summarizeActivity(activity),
        }));

      const workload = awakeAgents.length * 2 + departmentActivity.length;

      return {
        department,
        departmentAgents,
        awakeAgents,
        departmentActivity,
        workload,
      };
    });
  }, [activities, agents, departments]);

  if (departmentsLoading || agentsLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-28 w-full rounded-[2rem]" />
        <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-[320px] rounded-[2rem]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Department Center"
        title="Your AI workforce"
        description="Sales and the Executive Assistant are live today. The other divisions are staged and switch on one at a time."
        action={
          <StatusPill
            label="Divisions"
            value={`${departmentCards.filter((c) => c.department.isActive).length} live · ${departmentCards.filter((c) => !c.department.isActive).length} coming soon`}
            tone="active"
          />
        }
      />

      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {departmentCards.map(({ department, departmentAgents, awakeAgents, departmentActivity, workload }) => {
          const healthTone = awakeAgents.length > 0 ? "active" : "calm";

          if (!department.isActive) {
            return (
              <Card
                key={department.id}
                className="hq-panel flex h-full flex-col overflow-hidden border-dashed border-border bg-white/60 opacity-90"
              >
                <CardHeader className="space-y-4 border-b border-border/60 pb-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] opacity-60">{department.slug}</p>
                      <CardTitle className="font-display text-4xl tracking-[-0.05em] text-slate-700">{department.name}</CardTitle>
                      <p className="mt-2 text-sm leading-6 text-slate-700/70">
                        {department.description ?? "This division is staged for a later release."}
                      </p>
                    </div>
                    <StatusPill label="Status" value="Coming soon" tone="calm" />
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-amber-100/80">
                    <Construction className="h-6 w-6 text-zinc-900" />
                  </div>
                  <p className="max-w-xs text-sm leading-6 text-muted-foreground">
                    {departmentAgents[0]?.name ? `${departmentAgents[0].name} is staged and will come online in a later release.` : "This agent is not staffed yet."}
                  </p>
                </CardContent>
              </Card>
            );
          }

          return (
            <Card key={department.id} className="hq-panel flex h-full flex-col overflow-hidden border-border bg-white/90">
              <CardHeader className="space-y-4 border-b border-border/70 pb-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] opacity-70">
                      {department.slug}
                    </p>
                    <CardTitle className="font-display text-4xl tracking-[-0.05em]">{department.name}</CardTitle>
                    <p className="mt-2 text-sm leading-6 text-slate-800/75">
                      {department.description ?? "No description provided for this division."}
                    </p>
                  </div>
                  <StatusPill
                    label="Health"
                    value={getHealthLabel(workload)}
                    tone={healthTone}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge className="border-zinc-950 bg-zinc-950 text-white">
                    {awakeAgents.length} active
                  </Badge>
                  <Badge className="border-border bg-white/85 text-slate-900">
                    {departmentAgents.length} workers
                  </Badge>
                  <Badge className="border-border bg-white/85 text-slate-900">
                    {department.agentCount ?? departmentAgents.length} registered
                  </Badge>
                  {department.slug === "sales" ? (
                    <Button asChild size="sm" variant="outline" className="ml-auto rounded-xl">
                      <Link href="/sales">
                        <LineChart className="mr-1.5 h-3.5 w-3.5" /> Open Sales Desk
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </CardHeader>

              <CardContent className="flex flex-1 flex-col gap-5 p-6">
                <div className="rounded-[1.5rem] border border-border bg-white/82 p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-slate-700">
                      <Bot className="h-4 w-4" />
                      <p className="text-xs font-semibold uppercase tracking-[0.22em]">AI worker presence</p>
                    </div>
                    <span className="text-xs text-muted-foreground">Load {workload}/10</span>
                  </div>
                  <div className="max-h-[220px] space-y-2 overflow-y-auto no-scrollbar">
                    {departmentAgents.length > 0 ? (
                      departmentAgents.map((agent) => (
                        <div
                          key={agent.id}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-white/88 px-4 py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">{agent.name}</p>
                            <p className="text-xs text-muted-foreground">{agent.modelTier} tier</p>
                          </div>
                          <StatusPill
                            label="State"
                            value={agent.status.replace("_", " ")}
                            tone={agent.status === "active" || agent.status === "busy" ? "active" : "calm"}
                          />
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-border bg-white/85 px-4 py-4 text-sm text-muted-foreground">
                        No registered workers yet. This division is staged and ready to be staffed.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-border bg-white/82 p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-slate-700">
                      <Sparkles className="h-4 w-4" />
                      <p className="text-xs font-semibold uppercase tracking-[0.22em]">Recent activity</p>
                    </div>
                    <span className="text-xs text-muted-foreground">{activitiesLoading ? "Syncing" : "Live"}</span>
                  </div>
                  <div className="space-y-3">
                    {departmentActivity.length > 0 ? (
                      departmentActivity.map((activity) => (
                        <div
                          key={activity.id}
                          className="rounded-2xl border border-border bg-white/90 px-4 py-3 shadow-sm"
                        >
                          <div className="mb-1 flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-slate-900">{activity.summary}</p>
                            <Badge className={`border ${getToneClasses(activity.tone)}`}>{activity.tone}</Badge>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock3 className="h-3.5 w-3.5" />
                            <span>{formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-border bg-white/85 px-4 py-4 text-sm text-muted-foreground">
                        No recent signal has been routed through this division yet.
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
