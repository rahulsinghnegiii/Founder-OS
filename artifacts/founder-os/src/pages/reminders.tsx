import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Bell, Plus } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { SectionHeading, StatusPill } from "@/components/hq/primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";

type Reminder = {
  id: string;
  title: string;
  note: string | null;
  dueAt: string | null;
  done: boolean;
  createdAt: string;
};

export default function Reminders() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/reminders"],
    queryFn: () => fetcher<Reminder[]>("/api/reminders"),
  });
  const reminders = Array.isArray(data) ? data : [];

  if (isLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-28 w-full rounded-[2rem]" />
        <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[160px] rounded-[2rem]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Don't forget"
        title="Reminders"
        description="Prompts the EA is holding for you. Ask it to remind you about anything."
        action={<StatusPill label="Reminders" value={`${reminders.length}`} tone="active" />}
      />

      {reminders.length === 0 ? (
        <Card className="hq-panel bg-white/90">
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <Bell className="h-10 w-10 text-muted-foreground/50" />
            <p className="font-display text-2xl font-bold tracking-[-0.05em]">No reminders set</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Say "remind me to follow up with the investor" in the EA Desk.
            </p>
            <Link href="/chat">
              <Button className="rounded-[1.2rem] bg-zinc-950 px-5 text-white shadow-[4px_4px_0px_var(--shadow-ink)] hover:bg-zinc-900">
                <Plus className="h-4 w-4" /> Open EA Desk
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
          {reminders.map((reminder) => (
            <Card key={reminder.id} className="hq-panel bg-white/90">
              <CardContent className="space-y-3 p-6">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-display text-xl font-bold tracking-[-0.04em]">{reminder.title}</p>
                  {reminder.done ? (
                    <Badge className="border-border bg-white/85 text-slate-900">done</Badge>
                  ) : (
                    <Badge className="border-zinc-950 bg-zinc-950 text-white">active</Badge>
                  )}
                </div>
                {reminder.note ? <p className="text-sm leading-7 text-slate-700">{reminder.note}</p> : null}
                <p className="text-xs text-muted-foreground">
                  {reminder.dueAt
                    ? `Due ${formatDistanceToNow(new Date(reminder.dueAt), { addSuffix: true })}`
                    : `Set ${formatDistanceToNow(new Date(reminder.createdAt), { addSuffix: true })}`}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
