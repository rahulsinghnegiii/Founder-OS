import React from 'react';
import { useGetDashboardSummary, useGetDailyBriefing } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Activity, Briefcase, CheckSquare, Users, DollarSign, Bot, AlertCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function Dashboard() {
  const { data: summary, isLoading: isSummaryLoading } = useGetDashboardSummary();
  const { data: briefing, isLoading: isBriefingLoading } = useGetDailyBriefing();

  if (isSummaryLoading || isBriefingLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-[200px]" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Command Center</h1>
        <p className="text-muted-foreground">Welcome back. Here is your operational overview.</p>
      </div>

      {briefing && (
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-primary">
              <Bot className="w-5 h-5" />
              AI Daily Briefing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-foreground leading-relaxed">{briefing.summary}</p>
            {briefing.alerts && briefing.alerts.length > 0 && (
              <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                <ul className="text-sm text-destructive-foreground space-y-1">
                  {briefing.alerts.map((alert, i) => <li key={i}>{alert}</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Active Projects" value={summary?.activeProjects ?? 0} icon={Briefcase} />
        <MetricCard title="Open Tasks" value={summary?.openTasks ?? 0} icon={CheckSquare} />
        <MetricCard title="Total Leads" value={summary?.totalLeads ?? 0} icon={Users} />
        <MetricCard title="Monthly Revenue" value={`$${((summary?.revenueThisMonth ?? 0) / 1000).toFixed(1)}k`} icon={DollarSign} />
      </div>
    </div>
  );
}

function MetricCard({ title, value, icon: Icon }: { title: string, value: string | number, icon: any }) {
  return (
    <Card className="bg-card border-border/50 hover:bg-secondary/20 transition-colors">
      <CardContent className="p-6">
        <div className="flex items-center justify-between space-x-4">
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-muted-foreground">{title}</span>
            <span className="text-2xl font-bold">{value}</span>
          </div>
          <div className="p-3 bg-primary/10 rounded-full">
            <Icon className="w-5 h-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
