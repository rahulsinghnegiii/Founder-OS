import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Calendar, Plus } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { SectionHeading, StatusPill } from "@/components/hq/primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";

type Meeting = {
  id: string;
  title: string;
  attendee: string | null;
  scheduledAt: string | null;
  location: string | null;
  notes: string | null;
  createdAt: string;
};

export default function Meetings() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/meetings"],
    queryFn: () => fetcher<Meeting[]>("/api/meetings"),
  });
  const meetings = Array.isArray(data) ? data : [];

  if (isLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-28 w-full rounded-[2rem]" />
        <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[170px] rounded-[2rem]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Calendar"
        title="Meetings"
        description="Sessions the EA has scheduled on your behalf."
        action={<StatusPill label="Meetings" value={`${meetings.length}`} tone="active" />}
      />

      {meetings.length === 0 ? (
        <Card className="hq-panel bg-white/90">
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <Calendar className="h-10 w-10 text-muted-foreground/50" />
            <p className="font-display text-2xl font-bold tracking-[-0.05em]">No meetings scheduled</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Ask the EA to "schedule a meeting with Sarah from Acme."
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
          {meetings.map((meeting) => (
            <Card key={meeting.id} className="hq-panel bg-white/90">
              <CardContent className="space-y-3 p-6">
                <p className="font-display text-xl font-bold tracking-[-0.04em]">{meeting.title}</p>
                <div className="space-y-1 text-sm text-slate-700">
                  {meeting.attendee ? <p>With {meeting.attendee}</p> : null}
                  {meeting.scheduledAt ? (
                    <p>{formatDistanceToNow(new Date(meeting.scheduledAt), { addSuffix: true })}</p>
                  ) : null}
                  {meeting.location ? <p className="text-muted-foreground">{meeting.location}</p> : null}
                </div>
                {meeting.notes ? <p className="text-sm leading-7 text-slate-700">{meeting.notes}</p> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
