import React, { useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Compass, ListTree, Target } from "lucide-react";
import { SectionHeading, StatusPill } from "@/components/hq/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";

type PlanPhase = {
  name: string;
  weeks: number;
  departments: string[];
  deliverables: string[];
};

type Plan = {
  id: string;
  goal: string;
  context: string | null;
  phases: PlanPhase[];
  departments: string[];
  risks: string[];
  createdAt: string;
  updatedAt: string;
};

async function fetchPlans(): Promise<Plan[]> {
  const response = await fetch("/api/planner/plans");
  if (!response.ok) throw new Error("Failed to load plans");
  return response.json();
}

async function createPlan(input: { goal: string; context?: string }): Promise<Plan> {
  const response = await fetch("/api/planner/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Failed to generate plan");
  return response.json();
}

export default function Planner() {
  const queryClient = useQueryClient();
  const [goal, setGoal] = useState("");
  const [context, setContext] = useState("");

  const { data: plans, isLoading } = useQuery({
    queryKey: ["planner", "plans"],
    queryFn: fetchPlans,
  });

  const mutation = useMutation({
    mutationFn: createPlan,
    onSuccess: () => {
      setGoal("");
      setContext("");
      queryClient.invalidateQueries({ queryKey: ["planner", "plans"] });
    },
  });

  const list = Array.isArray(plans) ? plans : [];

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Strategic Planner"
        title="Execution plans"
        description="Generate structured, multi-phase plans from a goal and let the AI workforce execute against them."
        action={
          <StatusPill label="Plans" value={`${list.length} on file`} tone="calm" />
        }
      />

      <Card className="hq-panel border-border bg-white/90">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-zinc-950 text-white">
              <Compass className="h-5 w-5" />
            </div>
            <CardTitle className="font-display text-2xl font-bold tracking-[-0.05em]">Generate a plan</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground" htmlFor="plan-goal">
              Goal
            </label>
            <textarea
              id="plan-goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Describe the outcome you want, e.g. Launch a self-serve onboarding funnel for solo founders."
              rows={3}
              className="w-full rounded-2xl border border-border bg-white/85 px-4 py-3 text-sm leading-6 text-slate-800 shadow-sm outline-none focus:border-zinc-950"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground" htmlFor="plan-context">
              Context (optional)
            </label>
            <textarea
              id="plan-context"
              value={context}
              onChange={(event) => setContext(event.target.value)}
              placeholder="Add deadlines, constraints, or relevant background."
              rows={2}
              className="w-full rounded-2xl border border-border bg-white/85 px-4 py-3 text-sm leading-6 text-slate-800 shadow-sm outline-none focus:border-zinc-950"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={() => mutation.mutate({ goal, context: context || undefined })}
              disabled={goal.trim().length < 5 || mutation.isPending}
              className="rounded-2xl bg-zinc-950 px-6 text-white shadow-[5px_5px_0px_var(--shadow-ink)] hover:bg-zinc-900 disabled:opacity-50"
            >
              {mutation.isPending ? "Generating…" : "Generate plan"}
            </Button>
            {mutation.isError ? (
              <p className="text-sm text-rose-600">Something went wrong generating the plan.</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <section className="space-y-4">
        {isLoading ? (
          <div className="grid gap-6 lg:grid-cols-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} className="h-64 rounded-[2rem]" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="rounded-[2rem] border border-border bg-white/85 p-8 text-center shadow-sm">
            <Target className="mx-auto mb-4 h-10 w-10 text-muted-foreground/50" />
            <p className="font-display text-2xl font-bold tracking-[-0.05em]">No plans yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Describe a goal above and the Executive Assistant will generate a structured execution plan.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {list.map((plan) => (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
              >
                <Card className="hq-panel h-full border-border bg-white/90">
                  <CardHeader className="space-y-3 border-b border-border/70 pb-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-rose-300/90">
                          <Target className="h-5 w-5 text-zinc-950" />
                        </div>
                        <CardTitle className="font-display text-xl font-bold leading-snug tracking-[-0.05em]">
                          {plan.goal}
                        </CardTitle>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Created {formatDistanceToNow(new Date(plan.createdAt), { addSuffix: true })}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-5 p-6">
                    {plan.context ? (
                      <p className="rounded-2xl border border-border bg-white/80 px-4 py-3 text-sm leading-6 text-slate-700">
                        {plan.context}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      {plan.departments.map((department) => (
                        <Badge key={department} className="border-border bg-white/85 text-slate-800">
                          {department}
                        </Badge>
                      ))}
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-slate-700">
                        <ListTree className="h-4 w-4" />
                        <p className="text-xs font-semibold uppercase tracking-[0.22em]">
                          {plan.phases.length} phases
                        </p>
                      </div>
                      {plan.phases.map((phase, index) => (
                        <div key={index} className="rounded-2xl border border-border bg-white/85 px-4 py-3 shadow-sm">
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-semibold text-slate-900">{phase.name}</p>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <CalendarClock className="h-3.5 w-3.5" />
                              {phase.weeks}w
                            </span>
                          </div>
                          {phase.deliverables.length > 0 ? (
                            <ul className="mt-2 space-y-1 text-sm text-slate-700">
                              {phase.deliverables.map((deliverable) => (
                                <li key={deliverable} className="flex gap-2">
                                  <span className="text-primary">•</span>
                                  {deliverable}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ))}
                    </div>

                    {plan.risks.length > 0 ? (
                      <div className="rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3">
                        <div className="mb-2 flex items-center gap-2 text-rose-950">
                          <AlertTriangle className="h-4 w-4" />
                          <p className="text-xs font-semibold uppercase tracking-[0.22em]">Risks</p>
                        </div>
                        <ul className="space-y-1 text-sm text-slate-700">
                          {plan.risks.map((risk) => (
                            <li key={risk} className="flex gap-2">
                              <span className="text-rose-500">•</span>
                              {risk}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
