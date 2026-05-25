import React from 'react';
import { useListActivities } from '@workspace/api-client-react';
import { formatDistanceToNow } from 'date-fns';
import { Activity as ActivityIcon, Bot, User, System } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function Activities() {
  const { data: activities = [], isLoading } = useListActivities({ limit: 50 }, { query: { refetchInterval: 30000 } });

  const getActorIcon = (type: string | null | undefined) => {
    switch(type) {
      case 'agent': return <Bot className="w-4 h-4" />;
      case 'system': return <ActivityIcon className="w-4 h-4" />;
      default: return <User className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Activity Log</h1>
        <p className="text-muted-foreground">Chronological feed of all system actions.</p>
      </div>

      <div className="bg-card border border-border/50 rounded-lg p-6">
        <div className="space-y-8 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border/50 before:to-transparent">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border border-border bg-background shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 text-muted-foreground z-10">
                  <Skeleton className="w-4 h-4 rounded-full" />
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded border border-border/50 bg-secondary/20 shadow">
                  <Skeleton className="h-4 w-3/4 mb-2" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))
          ) : activities.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">No activities found.</div>
          ) : (
            activities.map((activity) => (
              <div key={activity.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
                <div className={`flex items-center justify-center w-10 h-10 rounded-full border border-border shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 ${
                  activity.actorType === 'agent' ? 'bg-primary/20 text-primary border-primary/30' : 'bg-secondary text-foreground'
                }`}>
                  {getActorIcon(activity.actorType)}
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-lg border border-border/50 bg-card hover:bg-secondary/30 transition-colors shadow-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-sm">{activity.actorName || activity.actorType || 'System'}</span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <span className="text-foreground">{activity.action}</span> on <span className="capitalize">{activity.entityType}</span>
                  </p>
                  {activity.details && Object.keys(activity.details).length > 0 && (
                    <div className="mt-3 text-xs font-mono bg-background/50 p-2 rounded border border-border/30 text-muted-foreground overflow-x-auto">
                      {JSON.stringify(activity.details)}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
