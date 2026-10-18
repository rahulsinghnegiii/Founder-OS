import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { UserPlus, Plus } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { SectionHeading, StatusPill } from "@/components/hq/primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";

type TeamMember = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  department: string | null;
  status: string;
  createdAt: string;
};

export default function TeamMembers() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/team-members"],
    queryFn: () => fetcher<TeamMember[]>("/api/team-members"),
  });
  const members = Array.isArray(data) ? data : [];

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
        eyebrow="People"
        title="Team"
        description="People the EA has added to your team."
        action={<StatusPill label="Members" value={`${members.length}`} tone="active" />}
      />

      {members.length === 0 ? (
        <Card className="hq-panel bg-white/90">
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <UserPlus className="h-10 w-10 text-muted-foreground/50" />
            <p className="font-display text-2xl font-bold tracking-[-0.05em]">No team members yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Ask the EA to "add a team member named Jordan as Growth Lead."
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
          {members.map((member) => (
            <Card key={member.id} className="hq-panel bg-white/90">
              <CardContent className="space-y-3 p-6">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-display text-xl font-bold tracking-[-0.04em]">{member.name}</p>
                  <Badge className="border-zinc-950 bg-zinc-950 text-white">{member.status}</Badge>
                </div>
                <div className="space-y-1 text-sm text-slate-700">
                  {member.role ? <p>{member.role}</p> : null}
                  {member.department ? <p className="text-muted-foreground">{member.department}</p> : null}
                  {member.email ? <p className="text-muted-foreground">{member.email}</p> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  Added {formatDistanceToNow(new Date(member.createdAt), { addSuffix: true })}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
