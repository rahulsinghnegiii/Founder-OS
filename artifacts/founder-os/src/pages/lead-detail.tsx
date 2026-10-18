import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useGetLead, useListProposals, getGetLeadQueryKey } from '@workspace/api-client-react';
import { useParams, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { fetcher } from '@/lib/fetcher';
import { format, formatDistanceToNow } from 'date-fns';
import { ArrowLeft, Mail, Building, Phone, Calendar, PenLine, Check, Sparkles } from 'lucide-react';

type FollowUp = {
  id: string;
  reason: string;
  subject: string;
  body: string;
  status: string;
  daysSilent: number;
  createdAt: string;
  sentAt: string | null;
};

function post<T>(url: string): Promise<T> {
  return fetcher<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
}

export default function LeadDetail() {
  const params = useParams();
  const id = params.id as string;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: lead, isLoading: leadLoading } = useGetLead(id, { query: { enabled: !!id } });
  const { data: proposals = [], isLoading: proposalsLoading } = useListProposals({ leadId: id }, { query: { enabled: !!id } });
  const followUpsKey = ['sales', 'lead-follow-ups', id] as const;
  const { data: followUps = [] } = useQuery({
    queryKey: followUpsKey,
    queryFn: () => fetcher<FollowUp[]>(`/api/sales/leads/${id}/follow-ups`),
    enabled: !!id,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: followUpsKey });
    void queryClient.invalidateQueries({ queryKey: getGetLeadQueryKey(id) });
    void queryClient.invalidateQueries({ queryKey: ['sales', 'overview'] });
  };

  const draft = useMutation({
    mutationFn: () => post<FollowUp>(`/api/sales/leads/${id}/draft`),
    onSuccess: () => {
      toast({ title: 'Follow-up drafted', description: 'Alex wrote a message for this lead.' });
      refresh();
    },
    onError: () => toast({ title: "Couldn't draft follow-up", variant: 'destructive' }),
  });

  const logContact = useMutation({
    mutationFn: () => post(`/api/sales/leads/${id}/contact`),
    onSuccess: () => {
      toast({ title: 'Contact logged' });
      refresh();
    },
  });

  const markSent = useMutation({
    mutationFn: (followUpId: string) => post(`/api/sales/follow-ups/${followUpId}/sent`),
    onSuccess: () => {
      toast({ title: 'Marked as sent' });
      refresh();
    },
  });

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

  const openDraft = followUps.find((f) => f.status === 'draft');
  const history = followUps.filter((f) => f.status !== 'draft');
  const lastTouch = lead.lastContactedAt ?? lead.createdAt;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Link href="/leads" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary transition-colors">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Pipeline
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">{lead.name}</h1>
          <div className="flex flex-wrap items-center gap-4 text-muted-foreground">
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
          {lead.score ? (
            <Badge variant="outline" className="text-xs">
              Score: {lead.score}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="hq-panel border-2 border-zinc-950 bg-white/95">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-500" />
                <CardTitle>Sales agent</CardTitle>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="rounded-xl" disabled={logContact.isPending} onClick={() => logContact.mutate()}>
                  <Check className="mr-1.5 h-3.5 w-3.5" /> I reached out
                </Button>
                <Button size="sm" className="rounded-xl bg-zinc-950 text-white hover:bg-zinc-900" disabled={draft.isPending} onClick={() => draft.mutate()}>
                  <PenLine className="mr-1.5 h-3.5 w-3.5" /> {draft.isPending ? 'Drafting…' : openDraft ? 'Rewrite follow-up' : 'Draft follow-up'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Last touch {lastTouch ? formatDistanceToNow(new Date(lastTouch), { addSuffix: true }) : 'unknown'}.
                {' '}Alex flags this stage after a few quiet days and drafts the follow-up for you.
              </p>
              {openDraft ? (
                <div className="rounded-2xl border border-border bg-slate-50 p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <Badge className="border-border bg-amber-100 text-amber-950">{openDraft.reason}</Badge>
                    <Button size="sm" className="rounded-xl bg-emerald-600 text-white hover:bg-emerald-700" disabled={markSent.isPending} onClick={() => markSent.mutate(openDraft.id)}>
                      <Check className="mr-1.5 h-3.5 w-3.5" /> Mark sent
                    </Button>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">Subject: {openDraft.subject}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{openDraft.body}</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border bg-white/80 px-4 py-4 text-sm text-muted-foreground">
                  No follow-up waiting for this lead.
                </div>
              )}
              {history.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">History</p>
                  {history.slice(0, 5).map((f) => (
                    <div key={f.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2 text-xs">
                      <span className="truncate text-slate-700">{f.subject}</span>
                      <span className="shrink-0 capitalize text-muted-foreground">
                        {f.status}{f.sentAt ? ` · ${format(new Date(f.sentAt), 'MMM d')}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

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
                          {proposal.sentAt ? `Sent ${format(new Date(proposal.sentAt), 'MMM d, yyyy')}` : `Created ${format(new Date(proposal.createdAt), 'MMM d, yyyy')}`}
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
