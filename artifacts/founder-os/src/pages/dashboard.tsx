import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Brain,
  CalendarClock,
  CheckSquare,
  CircleDollarSign,
  Compass,
  ListTree,
  Rocket,
  Target,
  TrendingUp,
  Users,
  Workflow,
  Zap,
} from "lucide-react";
import {
  useGetDailyBriefing,
  useGetDashboardSummary,
  useListActivities,
  useListAgents,
  useListDepartments,
  useListProjects,
  useListTasks,
  useListWorkflows,
} from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import { MetricPanel, StatusPill } from "@/components/hq/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getActivityTone,
  getHealthLabel,
  getToneClasses,
  summarizeActivity,
} from "@/lib/operations";

type Plan = {
  id: string;
  goal: string;
  phases: { name: string }[];
  departments: string[];
  risks: string[];
  createdAt: string;
};

async function fetchPlans(): Promise<Plan[]> {
  const response = await fetch("/api/planner/plans");
  if (!response.ok) throw new Error("Failed to load plans");
  return response.json();
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export default function Dashboard() {
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary();
  const { data: briefing } = useGetDailyBriefing();
  const { data: departmentsData } = useListDepartments();
  const { data: agentsData } = useListAgents();
  const { data: activitiesData } = useListActivities(
    { limit: 8 },
    { query: { refetchInterval: 20000 } },
  );
  const { data: workflowsData } = useListWorkflows();
  const { data: projectsData } = useListProjects();
  const { data: tasksData } = useListTasks();
  const { data: plans } = useQuery({ queryKey: ["planner", "plans"], queryFn: fetchPlans });

  const departments = asArray(departmentsData);
  const agents = asArray(agentsData);
  const activities = asArray(activitiesData);
  const workflows = asArray(workflowsData);
  const projects = asArray(projectsData);
  const tasks = asArray(tasksData);
  const planList = asArray(plans);

  const activeAgents = useMemo(
    () => agents.filter((agent) => agent.status === "active" || agent.status === "busy").length,
    [agents],
  );
  const urgentAlerts = summary?.urgentAlerts ?? 0;
  const unreadSignal = summary?.unreadNotifications ?? 0;

  const criticalAlerts = useMemo(() => {
    const items = [...(briefing?.alerts ?? [])];
    if (urgentAlerts > 0) {
      items.unshift(`${urgentAlerts} urgent operational alert${urgentAlerts === 1 ? "" : "s"} need attention.`);
    }
    return items.slice(0, 5);
  }, [briefing?.alerts, urgentAlerts]);

  const priorities = useMemo(() => briefing?.topPriorities ?? [], [briefing?.topPriorities]);

  const departmentHealth = useMemo(
    () =>
      departments.map((department) => {
        const departmentAgents = agents.filter((agent) => agent.departmentId === department.id);
        const awake = departmentAgents.filter(
          (agent) => agent.status === "active" || agent.status === "busy",
        ).length;
        return {
          id: department.id,
          name: department.name,
          isActive: department.isActive,
          awake,
          registered: department.agentCount ?? departmentAgents.length,
          load: awake * 2 + (department.agentCount ?? 0),
        };
      }),
    [agents, departments],
  );

  const activeExecutions = useMemo(() => workflows.filter((workflow) => workflow.isActive), [workflows]);

  const upcoming = useMemo(() => {
    const now = Date.now();
    const collected = [
      ...projects
        .filter((project) => project.dueDate && new Date(project.dueDate).getTime() >= now)
        .map((project) => ({ title: project.title, due: project.dueDate as string, kind: "Project" })),
      ...tasks
        .filter((task) => task.dueDate && new Date(task.dueDate).getTime() >= now)
        .map((task) => ({
          title: task.title,
          due: task.dueDate as string,
          kind: task.projectTitle ?? "Task",
        })),
    ];
    return collected
      .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime())
      .slice(0, 6);
  }, [projects, tasks]);

  const recentActivity = useMemo(
    () =>
      activities.slice(0, 6).map((activity) => ({
        ...activity,
        tone: getActivityTone(activity),
        summary: summarizeActivity(activity),
        entityLabel: (activity.entityType ?? "system").replace(/_/g, " "),
      })),
    [activities],
  );

  const systemHealthTone = urgentAlerts > 0 ? "attention" : "active";
  const systemHealthLabel = urgentAlerts > 0 ? "Needs attention" : "Nominal";

  const now = Date.now();
  const overdueTasks = tasks.filter(
    (task) => task.dueDate && new Date(task.dueDate).getTime() < now && task.status !== "done",
  ).length;
  const blockedDivisions = departments.filter(
    (department) => (department.agentCount ?? 0) === 0,
  ).length;

  const healthIssues = urgentAlerts > 0 || overdueTasks > 0 || blockedDivisions > 0;
  const healthTone: "active" | "attention" | "critical" = healthIssues
    ? urgentAlerts > 0
      ? "critical"
      : "attention"
    : "active";
  const healthLabel = healthIssues
    ? urgentAlerts > 0
      ? "Needs attention"
      : "Watch"
    : "Healthy";

  const summaryLines = [
    `${activeAgents} AI agent${activeAgents === 1 ? "" : "s"} active`,
    overdueTasks > 0
      ? `${overdueTasks} overdue task${overdueTasks === 1 ? "" : "s"}`
      : "No overdue work",
    urgentAlerts > 0
      ? `${urgentAlerts} urgent alert${urgentAlerts === 1 ? "" : "s"}`
      : "No urgent alerts",
    `Revenue ${
      summary?.revenueThisMonth
        ? `$${((summary.revenueThisMonth) / 1000).toFixed(1)}k this month`
        : "not recorded yet"
    }`,
    blockedDivisions > 0
      ? `${blockedDivisions} idle division${blockedDivisions === 1 ? "" : "s"}`
      : "No blocked departments",
  ];

  const riskText =
    briefing?.alerts && briefing.alerts.length > 0
      ? briefing.alerts[0]
      : overdueTasks > 0
        ? `${overdueTasks} task${overdueTasks === 1 ? "" : "s"} past due.`
        : blockedDivisions > 0
          ? `${blockedDivisions} division${blockedDivisions === 1 ? "" : "s"} without staff.`
          : "No active risks detected.";
  const riskSeverity: "high" | "medium" | "low" =
    urgentAlerts > 0 || overdueTasks > 0
      ? "high"
      : riskText !== "No active risks detected."
        ? "medium"
        : "low";

  const recommendationText =
    briefing?.suggestedFocus ??
    briefing?.recommendations?.[0] ??
    "Open the EA Desk to align on today's priorities.";

  if (summaryLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-28 w-full rounded-[2rem]" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-36 rounded-[2rem]" />
          ))}
        </div>
        <div className="grid gap-6 xl:grid-cols-2">
          <Skeleton className="h-[420px] rounded-[2rem]" />
          <Skeleton className="h-[420px] rounded-[2rem]" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Compact header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <div className="inline-flex rounded-full border border-border bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-muted-foreground shadow-sm">
            Operational HQ
          </div>
          <h1 className="font-display text-2xl font-bold tracking-[-0.05em] text-foreground">Mission Control</h1>
        </div>
        <StatusPill label="Status" value={healthLabel} tone={healthTone} />
      </div>

      {/* Executive cockpit — glanceable, above the fold */}
      <section className="grid gap-4 lg:grid-cols-12">
        <Card className="hq-panel bg-white/90 lg:col-span-5">
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-lg font-bold tracking-[-0.03em]">Today's Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5">
              {summaryLines.map((line) => (
                <li key={line} className="flex items-center gap-2.5 text-sm text-slate-700">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="hq-panel border-rose-200 bg-rose-50/40 lg:col-span-4">
          <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
            <CardTitle className="font-display text-lg font-bold tracking-[-0.03em]">Primary Risk</CardTitle>
            <Badge
              className={
                riskSeverity === "high"
                  ? "border-rose-300 bg-rose-100 text-rose-950"
                  : riskSeverity === "medium"
                    ? "border-amber-300 bg-amber-100 text-amber-950"
                    : "border-slate-300 bg-white text-slate-700"
              }
            >
              {riskSeverity === "high" ? "High" : riskSeverity === "medium" ? "Medium" : "Low"}
            </Badge>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-slate-700">{riskText}</p>
          </CardContent>
        </Card>

        <Card className="hq-panel border-2 border-zinc-950 bg-zinc-50 shadow-[8px_8px_0px_var(--shadow-ink)] lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-lg font-bold tracking-[-0.03em]">Recommended Action</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm leading-6 text-slate-700">{recommendationText}</p>
            <Button asChild size="sm" className="w-full rounded-2xl bg-zinc-950 px-4 text-white shadow-[4px_4px_0px_var(--shadow-ink)] hover:bg-zinc-900">
              <Link href="/chat">Open EA Desk</Link>
            </Button>
          </CardContent>
        </Card>
      </section>

      {/* KPI row — primary indicators, above the fold */}
      <section className="grid auto-rows-fr gap-6 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <MetricPanel
          label="Projects"
          value={summary?.activeProjects ?? 0}
          detail="Active initiatives"
          accentClass="bg-white/90"
          icon={<Target className="h-5 w-5 text-indigo-500" />}
        />
        <MetricPanel
          label="Tasks"
          value={summary?.openTasks ?? 0}
          detail="Open execution"
          accentClass="bg-sky-100/75"
          icon={<CheckSquare className="h-5 w-5 text-sky-600" />}
        />
        <MetricPanel
          label="Leads"
          value={summary?.totalLeads ?? 0}
          detail="Pipeline intake"
          accentClass="bg-rose-100/75"
          icon={<Users className="h-5 w-5 text-rose-500" />}
        />
        <MetricPanel
          label="Revenue"
          value={`$${((summary?.revenueThisMonth ?? 0) / 1000).toFixed(1)}k`}
          detail="This month"
          accentClass="bg-emerald-100/75"
          icon={<CircleDollarSign className="h-5 w-5 text-emerald-600" />}
        />
        <MetricPanel
          label="Unread"
          value={unreadSignal}
          detail="Signal waiting"
          accentClass="bg-amber-100/75"
          icon={<Zap className="h-5 w-5 text-amber-600" />}
        />
        <MetricPanel
          label="Agents"
          value={activeAgents}
          detail="Live across HQ"
          accentClass="bg-violet-100/75"
          icon={<Bot className="h-5 w-5 text-violet-600" />}
        />
      </section>

      {/* Command grid */}
      <section className="grid gap-5 xl:grid-cols-2">
        {/* Critical Alerts */}
        <Card className="hq-panel border-2 border-rose-200 bg-rose-50/40">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-rose-500 text-rose-50">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <CardTitle className="font-display text-2xl font-bold tracking-[-0.05em]">Critical Alerts</CardTitle>
            </div>
            <StatusPill label="Open" value={`${criticalAlerts.length}`} tone={criticalAlerts.length > 0 ? "critical" : "calm"} />
          </CardHeader>
          <CardContent>
            {criticalAlerts.length > 0 ? (
              <ul className="space-y-2">
                {criticalAlerts.map((alert, index) => (
                  <li key={index} className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-white/80 p-4 shadow-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                    <span className="text-sm leading-6 text-slate-800">{alert}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl border border-dashed border-rose-200 bg-white/70 px-4 py-6 text-center text-sm text-muted-foreground">
                No critical alerts. The command floor is clear.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Today's Priorities */}
        <Card className="hq-panel border-2 border-zinc-950 bg-zinc-50 shadow-[8px_8px_0px_var(--shadow-ink)]">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-zinc-950 text-white">
                <Target className="h-5 w-5" />
              </div>
              <CardTitle className="font-display text-2xl font-bold tracking-[-0.05em]">Today's Priorities</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {priorities.length > 0 ? (
              <ol className="space-y-2">
                {priorities.map((priority, index) => (
                  <li key={index} className="flex items-start gap-3 rounded-2xl border border-border bg-white/85 p-4 shadow-sm">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-mono font-bold">
                      {index + 1}
                    </span>
                    <span className="text-sm leading-6 text-slate-800">{priority}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="rounded-2xl border border-dashed border-border bg-white/70 px-4 py-6 text-center text-sm text-muted-foreground">
                No priorities flagged for today.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Department Health Overview */}
        <Card className="hq-panel bg-white/90">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-sky-100 text-sky-600">
                <Bot className="h-5 w-5" />
              </div>
              <CardTitle className="font-display text-2xl font-bold tracking-[-0.05em]">Department Health</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {departmentHealth.map((department) => (
              <div key={department.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-white/85 px-4 py-3 shadow-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{department.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {department.awake} awake · {department.registered} registered
                  </p>
                </div>
                <StatusPill
                  label="Load"
                  value={getHealthLabel(department.load)}
                  tone={department.awake > 0 ? "active" : "calm"}
                />
              </div>
            ))}
            {departmentHealth.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border bg-white/70 px-4 py-6 text-center text-sm text-muted-foreground">
                No departments configured yet.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* System Health */}
        <Card className="hq-panel bg-white/90">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-emerald-100 text-emerald-600">
                <TrendingUp className="h-5 w-5" />
              </div>
              <CardTitle className="font-display text-2xl font-bold tracking-[-0.05em]">System Health</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-border bg-emerald-100/70 p-4 shadow-sm">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-950">Agents live</p>
                <p className="font-display text-3xl font-bold tracking-[-0.05em] text-zinc-950">{activeAgents}</p>
              </div>
              <div className="rounded-2xl border border-border bg-sky-100/70 p-4 shadow-sm">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-950">Workflows active</p>
                <p className="font-display text-3xl font-bold tracking-[-0.05em] text-zinc-950">{activeExecutions.length}</p>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-white/85 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-800">Operational status</p>
                <StatusPill label="System" value={systemHealthLabel} tone={systemHealthTone} />
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {urgentAlerts > 0
                  ? `${urgentAlerts} urgent alert${urgentAlerts === 1 ? "" : "s"} require founder attention.`
                  : "All divisions nominal. No urgent alerts in the signal queue."}
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Secondary grid */}
      <section className="grid gap-5 xl:grid-cols-2">
        {/* Running Plans */}
        <Card className="hq-panel bg-white/90">
          <CardHeader className="flex flex-row items-end justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-violet-100 text-violet-600">
                <Rocket className="h-5 w-5" />
              </div>
              <CardTitle className="font-display text-2xl font-bold tracking-[-0.05em]">Running Plans</CardTitle>
            </div>
            <Button asChild variant="outline" size="sm" className="rounded-full bg-white">
              <Link href="/planner">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {planList.length > 0 ? (
              planList.slice(0, 4).map((plan) => (
                <div key={plan.id} className="rounded-2xl border border-border bg-white/85 px-4 py-3 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate font-medium text-slate-900">{plan.goal}</p>
                    <Badge className="border-border bg-white/80 text-slate-700">{plan.phases.length} phases</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Created {formatDistanceToNow(new Date(plan.createdAt), { addSuffix: true })}
                  </p>
                </div>
              ))
            ) : (
              <p className="rounded-2xl border border-dashed border-border bg-white/70 px-4 py-6 text-center text-sm text-muted-foreground">
                No plans generated yet.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Active Executions */}
        <Card className="hq-panel bg-white/90">
          <CardHeader className="flex flex-row items-end justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-100 text-amber-600">
                <Workflow className="h-5 w-5" />
              </div>
              <CardTitle className="font-display text-2xl font-bold tracking-[-0.05em]">Active Executions</CardTitle>
            </div>
            <StatusPill label="Running" value={`${activeExecutions.length}`} tone="active" />
          </CardHeader>
          <CardContent className="space-y-3">
            {activeExecutions.length > 0 ? (
              activeExecutions.slice(0, 5).map((workflow) => (
                <div key={workflow.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-white/85 px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className="pulse-dot" />
                    <div>
                      <p className="font-medium text-slate-900">{workflow.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {workflow.runCount} run{workflow.runCount === 1 ? "" : "s"}
                        {workflow.lastTriggeredAt
                          ? ` · last ${formatDistanceToNow(new Date(workflow.lastTriggeredAt), { addSuffix: true })}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800">Live</Badge>
                </div>
              ))
            ) : (
              <p className="rounded-2xl border border-dashed border-border bg-white/70 px-4 py-6 text-center text-sm text-muted-foreground">
                No active workflows running.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Upcoming Deadlines */}
        <Card className="hq-panel bg-white/90">
          <CardHeader className="flex flex-row items-end justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-rose-100 text-rose-600">
                <CalendarClock className="h-5 w-5" />
              </div>
              <CardTitle className="font-display text-2xl font-bold tracking-[-0.05em]">Upcoming Deadlines</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {upcoming.length > 0 ? (
              upcoming.map((item, index) => (
                <div key={index} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-white/85 px-4 py-3 shadow-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.kind}</p>
                  </div>
                  <Badge className="border-border bg-white/80 text-slate-700">
                    {formatDistanceToNow(new Date(item.due), { addSuffix: true })}
                  </Badge>
                </div>
              ))
            ) : (
              <p className="rounded-2xl border border-dashed border-border bg-white/70 px-4 py-6 text-center text-sm text-muted-foreground">
                No upcoming deadlines scheduled.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="hq-panel bg-white/90">
          <CardHeader className="flex flex-row items-end justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-indigo-100 text-indigo-600">
                <ListTree className="h-5 w-5" />
              </div>
              <CardTitle className="font-display text-2xl font-bold tracking-[-0.05em]">Recent Activity</CardTitle>
            </div>
            <Button asChild variant="outline" size="sm" className="rounded-full bg-white">
              <Link href="/activities">Open pulse</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentActivity.map((event) => (
              <div key={event.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-white/85 px-4 py-3 shadow-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{event.summary}</p>
                  <p className="text-xs text-muted-foreground">{event.entityLabel}</p>
                </div>
                <Badge className={`border ${getToneClasses(event.tone)}`}>{event.tone}</Badge>
              </div>
            ))}
            {recentActivity.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border bg-white/70 px-4 py-6 text-center text-sm text-muted-foreground">
                No recent activity.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>

      {/* Quick actions */}
      <section className="flex flex-wrap gap-3">
        <Button asChild className="rounded-2xl bg-zinc-950 px-6 text-white shadow-[5px_5px_0px_var(--shadow-ink)] hover:bg-zinc-900">
          <Link href="/chat">
            Talk to EA <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
        <Button asChild variant="outline" className="rounded-2xl bg-white/80 px-6">
          <Link href="/planner">Generate a plan</Link>
        </Button>
        <Button asChild variant="outline" className="rounded-2xl bg-white/80 px-6">
          <Link href="/departments">Review divisions</Link>
        </Button>
      </section>
    </div>
  );
}
