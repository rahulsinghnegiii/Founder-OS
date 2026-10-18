import React from 'react';
import { useListReports, useGenerateReport } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';
import { FileText, Plus, FileBarChart } from 'lucide-react';
import { EmptyState } from '@/components/hq/primitives';
import { useToast } from '@/hooks/use-toast';

export default function Reports() {
  const { data: reports = [], isLoading, refetch } = useListReports();
  const { mutate: generateReport, isPending } = useGenerateReport();
  const { toast } = useToast();

  const handleGenerate = () => {
    generateReport({ data: { type: 'weekly_summary', title: 'Weekly Business Summary' } }, {
      onSuccess: () => {
        toast({ title: 'Report generating...' });
        refetch();
      },
      onError: () => {
        toast({ title: 'Failed to generate report', variant: 'destructive' });
      }
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Reports</h1>
          <p className="text-muted-foreground">AI-generated analysis and business intelligence.</p>
        </div>
        <Button onClick={handleGenerate} disabled={isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground">
          <Plus className="w-4 h-4 mr-2" /> Generate Report
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : reports.length === 0 ? (
        <EmptyState
          icon={FileBarChart}
          title="No reports generated yet"
          description="Generate your first weekly summary to surface business intelligence across the organization."
          action={
            <Button onClick={handleGenerate} disabled={isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground">
              <Plus className="w-4 h-4 mr-2" /> Generate Report
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {reports.map((report) => (
            <Card key={report.id} className="bg-card border-border/50 hover:border-primary/50 transition-colors cursor-pointer group">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg group-hover:text-primary transition-colors line-clamp-1">{report.title}</CardTitle>
                      <p className="text-xs text-muted-foreground capitalize">{report.type.replace('_', ' ')}</p>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
                  {report.content ? report.content.substring(0, 150) + '...' : 'Report content generating...'}
                </p>
                <div className="text-xs text-muted-foreground">
                  Generated {formatDistanceToNow(new Date(report.createdAt), { addSuffix: true })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
