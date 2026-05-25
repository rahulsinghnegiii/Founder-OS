import React from 'react';
import { useListLeads } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from 'wouter';

const LEAD_STAGES = [
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'proposal', label: 'Proposal' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' }
];

export default function Leads() {
  const { data: leads = [], isLoading } = useListLeads();

  return (
    <div className="space-y-6 h-full flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Lead Pipeline</h1>
        <p className="text-muted-foreground">Track and manage prospective clients.</p>
      </div>

      <div className="flex-1 overflow-x-auto">
        <div className="flex gap-4 min-w-max h-full pb-4">
          {LEAD_STAGES.map((stage) => {
            const stageLeads = leads.filter(l => l.status === stage.id);
            return (
              <div key={stage.id} className="w-80 flex flex-col gap-3 bg-secondary/20 rounded-lg p-3 border border-border/50">
                <div className="flex items-center justify-between px-1">
                  <h3 className="font-semibold text-sm">{stage.label}</h3>
                  <Badge variant="secondary" className="bg-background text-muted-foreground">
                    {stageLeads.length}
                  </Badge>
                </div>
                
                <div className="flex flex-col gap-3 overflow-y-auto flex-1 pr-1">
                  {isLoading ? (
                    <Skeleton className="h-32 w-full rounded-md" />
                  ) : (
                    stageLeads.map(lead => (
                      <Link key={lead.id} href={`/leads/${lead.id}`} className="block">
                          <Card className="bg-card border-border/50 hover:border-primary/50 transition-colors cursor-pointer group">
                            <CardContent className="p-4 space-y-3">
                              <div className="flex justify-between items-start">
                                <div>
                                  <h4 className="font-medium group-hover:text-primary transition-colors">{lead.name}</h4>
                                  <p className="text-xs text-muted-foreground">{lead.company || '—'}</p>
                                </div>
                                {lead.score && (
                                  <Badge variant="outline" className={
                                    lead.score > 80 ? 'border-primary text-primary' :
                                    lead.score > 50 ? 'border-orange-500 text-orange-500' :
                                    'border-muted-foreground text-muted-foreground'
                                  }>
                                    {lead.score}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">{lead.estimatedValue ? `$${lead.estimatedValue.toLocaleString()}` : '—'}</span>
                                {lead.sentiment && (
                                  <span className={`capitalize ${
                                    lead.sentiment === 'positive' ? 'text-green-500' :
                                    lead.sentiment === 'negative' ? 'text-red-500' :
                                    'text-muted-foreground'
                                  }`}>{lead.sentiment}</span>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                      </Link>
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
