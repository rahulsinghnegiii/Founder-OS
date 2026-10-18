import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { StickyNote, Plus } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { SectionHeading, StatusPill } from "@/components/hq/primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";

type Note = {
  id: string;
  title: string | null;
  content: string;
  entityType: string | null;
  createdAt: string;
};

export default function Notes() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/notes"],
    queryFn: () => fetcher<Note[]>("/api/notes"),
  });
  const notes = Array.isArray(data) ? data : [];

  if (isLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-28 w-full rounded-[2rem]" />
        <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[180px] rounded-[2rem]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <SectionHeading
        eyebrow="Capture"
        title="Notes"
        description="Everything the Executive Assistant jots down on your behalf lives here. Ask the EA to remember anything."
        action={<StatusPill label="Notes" value={`${notes.length}`} tone="active" />}
      />

      {notes.length === 0 ? (
        <Card className="hq-panel bg-white/90">
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <StickyNote className="h-10 w-10 text-muted-foreground/50" />
            <p className="font-display text-2xl font-bold tracking-[-0.05em]">No notes yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Tell the EA something to remember and it will show up here.
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
          {notes.map((note) => (
            <Card key={note.id} className="hq-panel bg-white/90">
              <CardContent className="space-y-3 p-6">
                <p className="font-display text-xl font-bold tracking-[-0.04em]">
                  {note.title || "Untitled note"}
                </p>
                <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{note.content}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
                  {note.entityType ? ` · ${note.entityType}` : ""}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
