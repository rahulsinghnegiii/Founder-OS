import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useListLeads, useCreateLead, getListLeadsQueryKey } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Link } from 'wouter';
import { Plus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const LEAD_STAGES = [
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'proposal', label: 'Proposal' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' }
];

const EMPTY_FORM = { name: '', company: '', email: '', estimatedValue: '', source: '', status: 'new', notes: '' };

function NewLeadDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { mutate: createLead, isPending } = useCreateLead();

  const update = (key: keyof typeof EMPTY_FORM) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    createLead(
      {
        data: {
          name: form.name.trim(),
          company: form.company.trim() || undefined,
          email: form.email.trim() || undefined,
          source: form.source.trim() || undefined,
          notes: form.notes.trim() || undefined,
          status: form.status as 'new' | 'contacted' | 'qualified' | 'proposal' | 'won' | 'lost',
          estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : undefined,
        },
      },
      {
        onSuccess: (lead) => {
          toast({ title: `Added ${lead.name}`, description: 'Alex is scoring this lead now.' });
          void queryClient.invalidateQueries({ queryKey: getListLeadsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: ['sales', 'overview'] });
          setForm(EMPTY_FORM);
          setOpen(false);
        },
        onError: () => toast({ title: "Couldn't add lead", variant: 'destructive' }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="rounded-2xl bg-zinc-950 text-white shadow-[5px_5px_0px_var(--shadow-ink)] hover:bg-zinc-900">
          <Plus className="mr-2 h-4 w-4" /> New lead
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add a lead</DialogTitle>
            <DialogDescription>Alex will score it and start watching for silence.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="lead-name">Name</Label>
              <Input id="lead-name" value={form.name} onChange={(e) => update('name')(e.target.value)} placeholder="Priya Sharma" required autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-company">Company</Label>
              <Input id="lead-company" value={form.company} onChange={(e) => update('company')(e.target.value)} placeholder="Nimbus Labs" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-email">Email</Label>
              <Input id="lead-email" type="email" value={form.email} onChange={(e) => update('email')(e.target.value)} placeholder="priya@nimbuslabs.io" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-value">Estimated value ($)</Label>
              <Input id="lead-value" type="number" min="0" value={form.estimatedValue} onChange={(e) => update('estimatedValue')(e.target.value)} placeholder="12000" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-source">Source</Label>
              <Input id="lead-source" value={form.source} onChange={(e) => update('source')(e.target.value)} placeholder="Referral, inbound, conference…" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Stage</Label>
              <Select value={form.status} onValueChange={update('status')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_STAGES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="lead-notes">Notes</Label>
              <Textarea id="lead-notes" rows={3} value={form.notes} onChange={(e) => update('notes')(e.target.value)} placeholder="What do they need? Who decides? Any timing?" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || !form.name.trim()}>{isPending ? 'Adding…' : 'Add lead'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Leads() {
  const { data: leads = [], isLoading } = useListLeads();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Lead Pipeline</h1>
          <p className="text-muted-foreground">Track and manage prospective clients. Alex watches every open stage.</p>
        </div>
        <NewLeadDialog />
      </div>

      <div className="-mx-1 overflow-x-auto px-1 pb-2">
        <div className="flex items-start gap-4 pb-4">
          {LEAD_STAGES.map((stage) => {
            const stageLeads = leads.filter(l => l.status === stage.id);
            return (
              <div key={stage.id} className="flex w-[300px] shrink-0 flex-col gap-3 rounded-lg border border-border/50 bg-secondary/20 p-3">
                <div className="flex items-center justify-between px-1">
                  <h3 className="font-semibold text-sm">{stage.label}</h3>
                  <Badge variant="secondary" className="bg-background text-muted-foreground">
                    {stageLeads.length}
                  </Badge>
                </div>

                <div className="flex flex-col gap-3">
                  {isLoading ? (
                    <Skeleton className="h-32 w-full rounded-md" />
                  ) : (
                    stageLeads.map(lead => {
                      const lastTouch = lead.lastContactedAt ?? lead.createdAt;
                      return (
                      <Link key={lead.id} href={`/leads/${lead.id}`} className="block">
                          <Card className="bg-card border-border/50 hover:border-primary/50 transition-colors cursor-pointer group">
                            <CardContent className="p-4 space-y-3">
                              <div className="flex justify-between items-start">
                                <div>
                                  <h4 className="font-medium group-hover:text-primary transition-colors">{lead.name}</h4>
                                  <p className="text-xs text-muted-foreground">{lead.company || '—'}</p>
                                </div>
                                {lead.score ? (
                                  <Badge variant="outline" className={
                                    lead.score > 80 ? 'border-primary text-primary' :
                                    lead.score > 50 ? 'border-orange-500 text-orange-500' :
                                    'border-muted-foreground text-muted-foreground'
                                  }>
                                    {lead.score}
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">{lead.estimatedValue ? `$${lead.estimatedValue.toLocaleString()}` : '—'}</span>
                                <span className="text-muted-foreground">
                                  {lastTouch ? `touched ${formatDistanceToNow(new Date(lastTouch), { addSuffix: true })}` : ''}
                                </span>
                              </div>
                            </CardContent>
                          </Card>
                      </Link>
                      );
                    })
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
