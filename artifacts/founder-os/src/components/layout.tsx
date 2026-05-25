import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { 
  LayoutDashboard, 
  MessageSquare, 
  Briefcase, 
  CheckSquare, 
  Users, 
  LineChart, 
  Bot, 
  Zap, 
  FileText, 
  DollarSign, 
  Activity, 
  Settings,
  Bell,
  CheckCircle2,
  X
} from 'lucide-react';
import { 
  useListNotifications, 
  useMarkNotificationRead,
  useMarkAllNotificationsRead 
} from '@workspace/api-client-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: notifications = [], refetch } = useListNotifications({ unreadOnly: true }, { query: { refetchInterval: 30000 } });
  const { mutate: markRead } = useMarkNotificationRead();
  const { mutate: markAllRead } = useMarkAllNotificationsRead();
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  React.useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  const navItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/chat', label: 'EA Chat', icon: MessageSquare },
    { href: '/projects', label: 'Projects', icon: Briefcase },
    { href: '/tasks', label: 'Tasks', icon: CheckSquare },
    { href: '/leads', label: 'Leads', icon: Users },
    { href: '/pipeline', label: 'Pipeline', icon: LineChart },
    { href: '/agents', label: 'Agents', icon: Bot },
    { href: '/workflows', label: 'Workflows', icon: Zap },
    { href: '/reports', label: 'Reports', icon: FileText },
    { href: '/revenue', label: 'Revenue', icon: DollarSign },
    { href: '/activities', label: 'Activity Log', icon: Activity },
    { href: '/settings', label: 'Settings', icon: Settings },
  ];

  const handleMarkRead = (id: string) => {
    markRead({ id }, {
      onSuccess: () => refetch()
    });
  };

  const handleMarkAllRead = () => {
    markAllRead({}, {
      onSuccess: () => refetch()
    });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col hidden md:flex">
        <div className="p-4 border-b border-border">
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <div className="w-6 h-6 bg-primary rounded-md flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            FounderOS
          </h1>
        </div>
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium ${
              location === item.href ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}>
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Topbar */}
        <header className="h-14 border-b border-border bg-background flex items-center justify-between px-4">
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            
            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
              <SheetTrigger asChild>
                <button className="relative p-2 text-muted-foreground hover:text-foreground transition-colors rounded-full hover:bg-secondary">
                  <Bell className="w-5 h-5" />
                  {notifications.length > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full" />
                  )}
                </button>
              </SheetTrigger>
              <SheetContent className="w-[400px] sm:w-[540px] border-l border-border bg-card p-0 flex flex-col">
                <SheetHeader className="p-4 border-b border-border/50">
                  <div className="flex items-center justify-between">
                    <SheetTitle>Notifications</SheetTitle>
                    {notifications.length > 0 && (
                      <Button variant="ghost" size="sm" onClick={handleMarkAllRead} className="h-8 text-xs">
                        <CheckCircle2 className="w-4 h-4 mr-2" /> Mark all read
                      </Button>
                    )}
                  </div>
                </SheetHeader>
                <ScrollArea className="flex-1">
                  {notifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                      <Bell className="w-12 h-12 mb-4 opacity-20" />
                      <p>You're all caught up.</p>
                    </div>
                  ) : (
                    <div className="flex flex-col divide-y divide-border/50">
                      {notifications.map((notif) => (
                        <div key={notif.id} className="p-4 hover:bg-secondary/20 transition-colors flex items-start gap-4 group">
                          <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${
                            notif.priority === 'urgent' ? 'bg-destructive' :
                            notif.priority === 'high' ? 'bg-orange-500' :
                            'bg-primary'
                          }`} />
                          <div className="flex-1 space-y-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-medium text-sm leading-tight">{notif.title}</p>
                              <button 
                                onClick={() => handleMarkRead(notif.id)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                            {notif.body && <p className="text-sm text-muted-foreground line-clamp-2">{notif.body}</p>}
                            <p className="text-xs text-muted-foreground pt-1">
                              {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </SheetContent>
            </Sheet>

            <div className="w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center text-sm font-medium">
              F
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-auto p-6 bg-background">
          <div className="max-w-7xl mx-auto h-full">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
