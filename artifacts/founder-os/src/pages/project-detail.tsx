import React from 'react';
import { useGetProject, useListProjectTasks } from '@workspace/api-client-react';
import { useParams, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { ArrowLeft, CheckCircle2, Circle, Clock } from 'lucide-react';

export default function ProjectDetail() {
  const params = useParams();
  const id = params.id as string;
  
  const { data: project, isLoading: projectLoading } = useGetProject(id, { query: { enabled: !!id } });
  const { data: tasks = [], isLoading: tasksLoading } = useListProjectTasks(id, { query: { enabled: !!id } });

  if (projectLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32 mb-8" />
        <Skeleton className="h-10 w-[300px]" />
        <Skeleton className="h-4 w-[500px]" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
          <Skeleton className="h-48 w-full md:col-span-2" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  if (!project) return <div>Project not found</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <Link href="/projects" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary transition-colors">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Projects
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">{project.title}</h1>
          <p className="text-muted-foreground max-w-2xl">{project.description || 'No description provided.'}</p>
        </div>
        <Badge variant={project.status === 'active' ? 'default' : 'secondary'} className="text-sm">
          {project.status.replace('_', ' ')}
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-card border-border/50">
            <CardHeader>
              <CardTitle>Tasks</CardTitle>
            </CardHeader>
            <CardContent>
              {tasksLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : tasks.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">No tasks found for this project.</p>
              ) : (
                <div className="space-y-3">
                  {tasks.map(task => (
                    <div key={task.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-secondary/20 hover:bg-secondary/40 transition-colors">
                      <div className="flex items-center gap-3">
                        {task.status === 'done' ? (
                          <CheckCircle2 className="w-5 h-5 text-primary" />
                        ) : (
                          <Circle className="w-5 h-5 text-muted-foreground" />
                        )}
                        <span className={task.status === 'done' ? 'line-through text-muted-foreground' : 'text-foreground'}>
                          {task.title}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <Badge variant="outline" className="bg-background">{task.priority}</Badge>
                        {task.dueDate && (
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {format(new Date(task.dueDate), 'MMM d')}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-card border-border/50">
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground uppercase tracking-wider">Project Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex justify-between border-b border-border/50 pb-2">
                <span className="text-muted-foreground">Priority</span>
                <span className="capitalize">{project.priority}</span>
              </div>
              <div className="flex justify-between border-b border-border/50 pb-2">
                <span className="text-muted-foreground">Start Date</span>
                <span>{project.startDate ? format(new Date(project.startDate), 'MMM d, yyyy') : '—'}</span>
              </div>
              <div className="flex justify-between border-b border-border/50 pb-2">
                <span className="text-muted-foreground">Due Date</span>
                <span>{project.dueDate ? format(new Date(project.dueDate), 'MMM d, yyyy') : '—'}</span>
              </div>
              <div className="flex justify-between border-b border-border/50 pb-2">
                <span className="text-muted-foreground">Progress</span>
                <span>{project.completedTaskCount || 0} / {project.taskCount || 0} Tasks</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
