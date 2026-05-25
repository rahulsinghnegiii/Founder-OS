import React from 'react';
import { useListOpportunities } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';

const PIPELINE_STAGES = [
  { id: 'identified', label: 'Identified' },
  { id: 'evaluating', label: 'Evaluating' },
  { id: 'pursuing', label: 'Pursuing' },
  { id: 'closed_won', label: 'Closed Won' },
  { id: 'closed_lost', label: 'Closed Lost' }
];

export default function Pipeline() {
  const { data: opportunities = [], isLoading } = useListOpportunities();

  return (
    <div className="space-y-6 h-full flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Revenue Pipeline</h1>
        <p className="text-muted-foreground">Track deal flow and projected revenue.</p>
      </div>

      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-4 min-w-max h-full pb-4">
          {PIPELINE_STAGES.map((stage) => {
            const stageOpps = opportunities.filter(o => o.status === stage.id);
            const stageValue = stageOpps.reduce((sum, o) => sum + (o.value || 0), 0);
            
            return (
              <div key={stage.id} className="w-80 flex flex-col gap-3 bg-secondary/10 rounded-lg p-3 border border-border/30">
                <div className="flex items-center justify-between px-1 mb-2">
                  <div>
                    <h3 className="font-semibold text-sm">{stage.label}</h3>
                    <p className="text-xs font-mono text-primary mt-1">${(stageValue/1000).toFixed(1)}k</p>
                  </div>
                  <Badge variant="secondary" className="bg-background text-muted-foreground">
                    {stageOpps.length}
                  </Badge>
                </div>
                
                <div className="flex flex-col gap-3 overflow-y-auto flex-1 pr-1">
                  {isLoading ? (
                    <Skeleton className="h-32 w-full rounded-md" />
                  ) : (
                    stageOpps.map(opp => (
                      <Card key={opp.id} className="bg-card border-border/50 hover:border-primary/40 transition-colors cursor-pointer group">
                        <CardContent className="p-4 space-y-3">
                          <h4 className="font-medium text-sm group-hover:text-primary transition-colors line-clamp-2">{opp.title}</h4>
                          <div className="flex items-center justify-between">
                            <span className="text-lg font-bold">${((opp.value || 0)/1000).toFixed(1)}k</span>
                            <Badge variant="outline" className="bg-secondary/30">
                              {opp.probability}% Win
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/30">
                            <span>{opp.leadName || 'No Lead'}</span>
                            <span>{opp.expectedCloseDate ? format(new Date(opp.expectedCloseDate), 'MMM d') : 'No date'}</span>
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
