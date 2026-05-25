import React from 'react';
import { useGetLead, useListProposals } from '@workspace/api-client-react';
import { useParams, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { ArrowLeft, Mail, Building, Phone, Calendar } from 'lucide-react';

export default function LeadDetail() {
  const params = useParams();
  const id = params.id as string;
  
  const { data: lead, isLoading: leadLoading } = useGetLead(id, { query: { enabled: !!id } });
  const { data: proposals = [], isLoading: proposalsLoading } = useListProposals({ leadId: id }, { query: { enabled: !!id } });

  if (leadLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32 mb-8" />
        <Skeleton className="h-10 w-[300px]" />
        <Skeleton className="h-4 w-[500px]" />
      </div>
    );
  }

  if (!lead) return <div>Lead not found</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Link href="/leads" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary transition-colors">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Pipeline
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">{lead.name}</h1>
          <div className="flex items-center gap-4 text-muted-foreground">
            {lead.company && (
              <span className="flex items-center gap-1">
                <Building className="w-4 h-4" /> {lead.company}
              </span>
            )}
            {lead.email && (
              <span className="flex items-center gap-1">
                <Mail className="w-4 h-4" /> {lead.email}
              </span>
            )}
            {lead.phone && (
              <span className="flex items-center gap-1">
                <Phone className="w-4 h-4" /> {lead.phone}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant="default" className="capitalize text-sm bg-primary/20 text-primary hover:bg-primary/30">
            {lead.status.replace('_', ' ')}
          </Badge>
          {lead.score && (
            <Badge variant="outline" className="text-xs">
              Score: {lead.score}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-card border-border/50">
            <CardHeader>
              <CardTitle>Proposals</CardTitle>
            </CardHeader>
            <CardContent>
              {proposalsLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : proposals.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">No proposals created yet.</p>
              ) : (
                <div className="space-y-4">
                  {proposals.map(proposal => (
                    <div key={proposal.id} className="p-4 rounded-lg border border-border/50 bg-secondary/20 hover:border-primary/50 transition-colors">
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="font-semibold">{proposal.title}</h4>
                        <Badge variant="outline" className="capitalize">{proposal.status}</Badge>
                      </div>
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">${((proposal.value || 0)).toLocaleString()}</span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Created {format(new Date(proposal.createdAt), 'MMM d, yyyy')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {lead.notes && (
            <Card className="bg-card border-border/50">
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{lead.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="bg-card border-border/50">
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground uppercase tracking-wider">Lead Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex justify-between border-b border-border/50 pb-2">
                <span className="text-muted-foreground">Estimated Value</span>
                <span className="font-medium text-primary">${(lead.estimatedValue || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between border-b border-border/50 pb-2">
                <span className="text-muted-foreground">Source</span>
                <span className="capitalize">{lead.source || '—'}</span>
              </div>
              <div className="flex justify-between border-b border-border/50 pb-2">
                <span className="text-muted-foreground">Sentiment</span>
                <span className={`capitalize ${
                  lead.sentiment === 'positive' ? 'text-green-500' :
                  lead.sentiment === 'negative' ? 'text-red-500' :
                  ''
                }`}>{lead.sentiment || '—'}</span>
              </div>
              <div className="flex justify-between border-b border-border/50 pb-2">
                <span className="text-muted-foreground">Last Contact</span>
                <span>{lead.lastContactedAt ? format(new Date(lead.lastContactedAt), 'MMM d, yyyy') : '—'}</span>
              </div>
              <div className="flex justify-between pt-2">
                <span className="text-muted-foreground">Added</span>
                <span>{format(new Date(lead.createdAt), 'MMM d, yyyy')}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
