import React from 'react';
import { useListWorkflows, useTriggerWorkflow } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Play, Activity, Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

export default function Workflows() {
  const { data: workflows = [], isLoading } = useListWorkflows();
  const { mutate: triggerWorkflow, isPending } = useTriggerWorkflow();
  const { toast } = useToast();

  const handleTrigger = (id: string) => {
    triggerWorkflow({ id }, {
      onSuccess: () => {
        toast({ title: 'Workflow triggered successfully' });
      },
      onError: () => {
        toast({ title: 'Failed to trigger workflow', variant: 'destructive' });
      }
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Automations</h1>
          <p className="text-muted-foreground">Manage your AI agent workflows and background tasks.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : workflows.length === 0 ? (
        <Card className="bg-card border-border/50">
          <CardContent className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Activity className="w-12 h-12 mb-4 opacity-20" />
            <p>No workflows configured.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {workflows.map((workflow) => (
            <Card key={workflow.id} className="bg-card border-border/50 group hover:border-primary/30 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">{workflow.name}</CardTitle>
                    <CardDescription className="font-mono text-xs">Trigger: {workflow.triggerEvent}</CardDescription>
                  </div>
                  <Switch checked={workflow.isActive} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-6 mb-6">
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground mb-1">Runs</span>
                    <span className="text-xl font-bold font-mono">{workflow.runCount}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground mb-1">Last Triggered</span>
                    <span className="text-sm font-medium flex items-center gap-1">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      {workflow.lastTriggeredAt ? formatDistanceToNow(new Date(workflow.lastTriggeredAt), { addSuffix: true }) : 'Never'}
                    </span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between pt-4 border-t border-border/50">
                  <Badge variant="outline" className="bg-secondary/30">
                    {workflow.steps?.length || 0} steps
                  </Badge>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="hover:bg-primary/20 hover:text-primary"
                    onClick={() => handleTrigger(workflow.id)}
                    disabled={isPending}
                  >
                    <Play className="w-4 h-4 mr-2" /> Run Now
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
