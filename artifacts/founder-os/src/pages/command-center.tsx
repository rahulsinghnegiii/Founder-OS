import React, { useMemo } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Activity,
  Zap,
  ShieldAlert,
  Target,
  Trophy,
  Brain,
  Layers,
  Sparkles,
  Command,
  CheckSquare,
} from "lucide-react";
import {
  useGetDailyBriefing,
  useGetDashboardSummary,
  useListActivities,
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { SectionHeading, StatusPill } from "@/components/hq/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { DailyBriefing } from "@workspace/api-client-react";

interface Prediction {
  title: string;
  analysis: string;
  impact: "critical" | "high" | "medium" | "low";
}

interface StructuredRecommendation {
  recommendation: string;
  analysis: string;
  expectedImpact: string;
  risks: string[];
}

interface DecisionIQ {
  leverageScore: number;
  alignmentScore: number;
  leverageAnalysis: string;
  alignmentAnalysis: string;
}

interface CommandBriefing extends DailyBriefing {
  predictions?: Prediction[];
  decisionIQ?: DecisionIQ;
  structuredRecommendations?: StructuredRecommendation[];
}

export default function CommandCenter() {
  const { data: briefingData, isLoading: briefingLoading } = useGetDailyBriefing();
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary();
  const { data: activitiesData } = useListActivities({ limit: 5 });

  const briefing = briefingData as CommandBriefing | undefined;
  const activities = Array.isArray(activitiesData) ? activitiesData : [];

  if (briefingLoading || summaryLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-[200px] w-full rounded-[2.5rem]" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-[400px] rounded-[2.5rem]" />
          <Skeleton className="h-[400px] rounded-[2.5rem]" />
          <Skeleton className="h-[400px] rounded-[2.5rem]" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Strategic Command"
        title="Founder Command Center"
        description="The strategic heart of your AI organization. Realtime intelligence, bottleneck detection, and leverage surfacing."
        action={
          <div className="flex gap-2">
             <StatusPill label="State" value="Strategic Mode" tone="active" />
             <StatusPill label="Briefing" value={briefing?.date || "Current"} tone="calm" />
          </div>
        }
      />

      {/* 1. THE EXECUTIVE BRIEFING (Main Hero) */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]"
      >
        <Card className="hq-panel overflow-hidden border-2 border-zinc-950 bg-[#0a0a0a] text-zinc-50 shadow-[12px_12px_0px_var(--shadow-ink)]">
          <CardContent className="p-10">
            <div className="mb-8 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-zinc-950">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-display text-4xl font-bold tracking-tight">Morning Intelligence</h2>
                  <p className="text-sm text-zinc-400">Synthesized operational state for {briefing?.date}</p>
                </div>
              </div>
              <Badge variant="outline" className="border-zinc-800 text-zinc-400">
                Live autonomy
              </Badge>
            </div>

            <div className="space-y-8">
              <p className="font-display text-2xl leading-relaxed text-zinc-200">
                {briefing?.summary}
              </p>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-4 rounded-[2rem] border border-zinc-800 bg-zinc-900/50 p-6">
                  <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                    <Target className="h-4 w-4 text-primary" />
                    Top Strategic Priorities
                  </h3>
                  <div className="space-y-3">
                    {(briefing?.topPriorities ?? []).map((priority, i) => (
                      <div key={i} className="flex gap-3 text-sm leading-relaxed text-zinc-300">
                        <span className="font-mono text-zinc-600">0{i+1}</span>
                        <span>{priority}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 rounded-[2rem] border border-zinc-800 bg-zinc-900/50 p-6">
                  <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                    <ShieldAlert className="h-4 w-4 text-rose-500" />
                    Operational Forecasts
                  </h3>
                  <div className="space-y-3">
                    {briefing?.predictions?.slice(0, 3).map((prediction, i) => (
                      <div key={i} className="flex gap-3 text-sm leading-relaxed text-zinc-300">
                         <div className={cn(
                           "mt-1 h-2 w-2 shrink-0 rounded-full",
                           prediction.impact === "critical" ? "bg-rose-500 animate-pulse" :
                           prediction.impact === "high" ? "bg-amber-500" : "bg-sky-500"
                         )} />
                         <div>
                            <p className="font-semibold text-zinc-200">{prediction.title}</p>
                            <p className="text-xs text-zinc-500">{prediction.analysis}</p>
                         </div>
                      </div>
                    ))}
                    {(!briefing?.predictions || briefing?.predictions?.length === 0) && (briefing?.alerts ?? []).map((alert, i) => (
                      <div key={i} className="flex gap-3 text-sm leading-relaxed text-zinc-300">
                         <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500/50" />
                         <span>{alert}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-4">
                 <Button asChild className="rounded-2xl bg-primary px-8 py-6 text-lg font-bold text-zinc-950 hover:bg-primary/90">
                    <Link href="/chat">
                      Open War Room <ArrowRight className="ml-2 h-5 w-5" />
                    </Link>
                 </Button>
                  <Button asChild variant="outline" className="rounded-2xl border-zinc-800 bg-transparent px-8 py-6 text-lg font-bold text-zinc-300 hover:bg-zinc-900">
                    <Link href="/hq">View Operational HQ</Link>
                  </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Decision Pulse */}
        <div className="space-y-6">
           <Card className="hq-panel border-2 border-zinc-950 bg-white shadow-[8px_8px_0px_var(--shadow-ink)]">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-zinc-500">
                  <Brain className="h-4 w-4" /> Decision IQ
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-2xl bg-zinc-50 p-4 border border-zinc-100">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-1">Leverage</p>
                    <p className="font-display text-3xl font-bold tracking-tight">{briefing?.decisionIQ?.leverageScore ?? 0}%</p>
                  </div>
                  <div className="rounded-2xl bg-zinc-50 p-4 border border-zinc-100">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-1">Alignment</p>
                    <p className="font-display text-3xl font-bold tracking-tight">{briefing?.decisionIQ?.alignmentScore ?? 0}%</p>
                  </div>
                </div>
                <div className="space-y-2 border-t border-zinc-50 pt-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Strategic Analysis:</p>
                  <p className="text-xs text-zinc-600 leading-relaxed">
                    {briefing?.decisionIQ?.leverageAnalysis}
                  </p>
                  <p className="text-xs text-zinc-600 leading-relaxed border-t border-zinc-50 pt-2">
                    {briefing?.decisionIQ?.alignmentAnalysis}
                  </p>
                </div>
              </CardContent>
           </Card>

           <Card className="hq-panel border-2 border-zinc-950 bg-emerald-50 shadow-[8px_8px_0px_var(--shadow-ink)]">
               <CardHeader className="pb-2">
                 <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-emerald-800">
                   <Trophy className="h-4 w-4" /> Opportunity surfaced
                 </CardTitle>
               </CardHeader>
               <CardContent>
                   {(briefing?.opportunities?.length ?? 0) > 0 ? (
                     <>
                       <p className="text-sm font-bold text-emerald-950 mb-2">{briefing?.opportunities?.[0]}</p>
                       <p className="text-xs text-emerald-800/80 leading-relaxed mb-4">{briefing?.opportunities?.[1] ?? "No additional details."}</p>
                     <Button variant="outline" size="sm" className="w-full rounded-xl border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50">
                       Review
                     </Button>
                   </>
                 ) : (
                   <>
                     <p className="text-sm font-bold text-emerald-950 mb-2">{summary?.totalLeads ?? 0} active leads</p>
                     <p className="text-xs text-emerald-800/80 leading-relaxed mb-4">
                       Pipeline has {summary?.totalLeads ?? 0} leads. Stay close to the warmest opportunities.
                     </p>
                   </>
                 )}
               </CardContent>
           </Card>
        </div>
      </motion.section>

      {/* 2. STRATEGIC RECOMMENDATIONS (The "COO" Layer) */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-3xl font-bold tracking-tight">Strategic Recommendations</h2>
          <Button variant="link" className="text-zinc-500 hover:text-primary">
            View All <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {(briefing?.structuredRecommendations ?? []).map((rec, i) => (
            <Card key={i} className="hq-panel group relative overflow-hidden border-2 border-zinc-950 bg-white p-2 shadow-[8px_8px_0px_var(--shadow-ink)] transition-all hover:-translate-y-1">
              <div className="absolute top-0 right-0 p-4">
                <Badge className="rounded-full bg-zinc-950 text-white px-3 py-1 text-[10px] uppercase tracking-widest">
                  High Impact
                </Badge>
              </div>
              <CardHeader className="space-y-4 p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 group-hover:bg-primary group-hover:text-zinc-950 transition-colors">
                  <Layers className="h-6 w-6" />
                </div>
                <div>
                  <CardTitle className="font-display text-2xl font-bold tracking-tight">{rec.recommendation}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-6 p-6 pt-0">
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Analysis</p>
                  <p className="text-sm leading-relaxed text-zinc-600">{rec.analysis}</p>
                </div>
                
                <div className="grid grid-cols-2 gap-4 border-t border-zinc-100 pt-6">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-600 mb-1">Impact</p>
                    <p className="text-xs font-semibold text-zinc-800">{rec.expectedImpact}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-rose-500 mb-1">Risks</p>
                    <p className="text-xs font-semibold text-zinc-800">{rec.risks[0]}</p>
                  </div>
                </div>

                <Button className="w-full rounded-2xl bg-zinc-950 text-white hover:bg-zinc-800">
                  Approve Execution Plan
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* 3. OPERATIONAL PRESENCE (The "Command Bridge" Feeds) */}
      <section className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
        <Card className="hq-panel bg-white shadow-[10px_10px_0px_var(--shadow-ink)] border-2 border-zinc-950">
           <CardHeader className="flex flex-row items-center justify-between border-b border-zinc-100 pb-6">
              <div>
                <CardTitle className="font-display text-2xl font-bold tracking-tight">Active Pulse</CardTitle>
                <p className="text-sm text-zinc-500">Live operational events across all AI divisions</p>
              </div>
              <Activity className="h-5 w-5 text-zinc-400" />
           </CardHeader>
           <CardContent className="p-0">
              <div className="divide-y divide-zinc-100">
                {activities.map((activity, i) => (
                  <div key={i} className="flex items-center justify-between p-6 hover:bg-zinc-50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <div className="h-3 w-3 rounded-full bg-emerald-500" />
                        <div className="absolute inset-0 h-3 w-3 animate-ping rounded-full bg-emerald-500 opacity-75" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-zinc-900">{activity.actorName || "AI System"}</p>
                        <p className="text-xs text-zinc-500">{activity.action.replace(/_/g, " ")} on {activity.entityType}</p>
                      </div>
                    </div>
                    <Badge variant="secondary" className="rounded-full bg-zinc-100 text-[10px] uppercase font-bold text-zinc-600">
                      {new Date(activity.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Badge>
                  </div>
                ))}
              </div>
           </CardContent>
        </Card>

        <div className="space-y-6">
           <Card className="hq-panel bg-[#f8fafc] border-2 border-zinc-950 shadow-[10px_10px_0px_var(--shadow-ink)]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-display text-xl font-bold">
                  <Command className="h-5 w-5" /> Executive Shortcuts
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                 <Button variant="outline" className="h-auto flex-col items-start gap-1 p-4 rounded-2xl border-zinc-200 bg-white hover:border-primary transition-all">
                    <Zap className="h-4 w-4 text-amber-500" />
                    <span className="font-bold">Urgent Review</span>
                     <span className="text-[10px] text-zinc-400">{summary?.urgentAlerts ?? 0} urgent</span>
                 </Button>
                 <Button variant="outline" className="h-auto flex-col items-start gap-1 p-4 rounded-2xl border-zinc-200 bg-white hover:border-primary transition-all">
                    <CheckSquare className="h-4 w-4 text-sky-500" />
                    <span className="font-bold">Daily Tasks</span>
                    <span className="text-[10px] text-zinc-400">{summary?.openTasks} in progress</span>
                 </Button>
                 <Button variant="outline" className="h-auto flex-col items-start gap-1 p-4 rounded-2xl border-zinc-200 bg-white hover:border-primary transition-all">
                    <Target className="h-4 w-4 text-rose-500" />
                    <span className="font-bold">Pipeline</span>
                    <span className="text-[10px] text-zinc-400">{summary?.totalLeads} active leads</span>
                 </Button>
                 <Button variant="outline" className="h-auto flex-col items-start gap-1 p-4 rounded-2xl border-zinc-200 bg-white hover:border-primary transition-all">
                    <Activity className="h-4 w-4 text-emerald-500" />
                    <span className="font-bold">HQ Analytics</span>
                     <span className="text-[10px] text-zinc-400">{summary?.activeAgents ?? 0} agents live</span>
                 </Button>
              </CardContent>
           </Card>

           <Card className="hq-panel border-2 border-zinc-950 bg-amber-50 shadow-[10px_10px_0px_var(--shadow-ink)]">
               <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                     <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-200 text-amber-950">
                        <AlertTriangle className="h-5 w-5" />
                     </div>
                     <div className="space-y-2">
                         <p className="font-bold text-amber-950">
                           {(briefing?.alerts?.length ?? 0) > 0 ? "Operational Alert" : "System Status"}
                         </p>
                         <p className="text-sm text-amber-900/70 leading-relaxed">
                           {(briefing?.alerts?.length ?? 0) > 0
                             ? briefing?.alerts?.[0]
                             : `All systems nominal. ${summary?.activeAgents ?? 0} agents online, ${summary?.openTasks ?? 0} tasks active.`}
                        </p>
                     </div>
                  </div>
               </CardContent>
            </Card>
        </div>
      </section>
    </div>
  );
}
