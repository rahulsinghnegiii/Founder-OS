import React from "react";
import { Link, useLocation } from "wouter";
import { Construction, LineChart } from "lucide-react";
import { SectionHeading, StatusPill } from "@/components/hq/primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const LABELS: Record<string, { title: string; blurb: string }> = {
  "/hq": { title: "Operational HQ", blurb: "A mission-control view across every department." },
  "/command-center": { title: "Command Center", blurb: "Cross-department intelligence and decision support." },
  "/agents": { title: "Agents", blurb: "Per-agent configuration and run history." },
  "/workflows": { title: "Automations", blurb: "A visual builder for your own rules. The Sales automations already run for you." },
  "/revenue": { title: "Revenue", blurb: "Invoiced, received, and projected revenue with trends." },
  "/reports": { title: "Reports", blurb: "AI-written operational and revenue reports." },
  "/pipeline": { title: "Radar", blurb: "Opportunity tracking beyond the lead pipeline." },
  "/planner": { title: "Planner", blurb: "Goal-to-plan generation with phased execution." },
  "/notes": { title: "Notes", blurb: "Lightweight notes linked to deals and projects." },
  "/reminders": { title: "Reminders", blurb: "Standalone reminders. Sales follow-ups already create tasks for you." },
  "/meetings": { title: "Meetings", blurb: "Calendar sync and meeting prep." },
  "/team": { title: "Team", blurb: "Human teammates alongside your AI departments." },
};

export default function ComingSoon() {
  const [location] = useLocation();
  const meta = LABELS[location] ?? { title: "This area", blurb: "This part of FounderOS is not switched on yet." };

  return (
    <div className="space-y-6">
      <SectionHeading
        eyebrow="Coming soon"
        title={meta.title}
        description={meta.blurb}
        action={<StatusPill label="Status" value="Not yet live" tone="calm" />}
      />
      <Card className="hq-panel border-2 border-dashed border-border bg-white/80">
        <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-border bg-amber-100 shadow-[5px_5px_0px_var(--shadow-ink)]">
            <Construction className="h-7 w-7 text-zinc-950" />
          </div>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            FounderOS is shipping one department at a time. Sales is live today: your pipeline is watched, follow-ups
            are drafted, and new leads are scored automatically.
          </p>
          <Button asChild className="rounded-2xl bg-zinc-950 text-white shadow-[5px_5px_0px_var(--shadow-ink)] hover:bg-zinc-900">
            <Link href="/sales">
              <LineChart className="mr-2 h-4 w-4" /> Open the Sales Desk
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
