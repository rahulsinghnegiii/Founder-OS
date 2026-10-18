import React, { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Activity,
  Bell,
  Bot,
  Briefcase,
  CheckSquare,
  LayoutDashboard,
  LineChart,
  MessageSquare,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  Settings,
  Users,
  X,
} from "lucide-react";
import {
  useListActivities,
  useListAgents,
  useListNotifications,
  useListWorkflows,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import { ContextRail, StatusPill } from "@/components/hq/primitives";
import { FloatingVoiceMic } from "@/components/hq/FloatingVoiceMic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  emphasis?: boolean;
};

const navItems: NavItem[] = [
  { href: "/", label: "Command Center", shortLabel: "Cmd", icon: LayoutDashboard, emphasis: true },
  { href: "/chat", label: "EA Desk", shortLabel: "EA", icon: MessageSquare },
  { href: "/sales", label: "Sales Desk", shortLabel: "Sales", icon: LineChart, emphasis: true },
  { href: "/departments", label: "Departments", shortLabel: "Depts", icon: Bot },
  { href: "/leads", label: "Leads", shortLabel: "Leads", icon: Users },
  { href: "/projects", label: "Projects", shortLabel: "Projects", icon: Briefcase },
  { href: "/tasks", label: "Tasks", shortLabel: "Tasks", icon: CheckSquare },
  { href: "/activities", label: "Activity", shortLabel: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", shortLabel: "Settings", icon: Settings },
];

function isCurrentPath(location: string, href: string): boolean {
  if (href === "/") return location === "/";
  return location === href || location.startsWith(`${href}/`);
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="group flex items-center gap-3">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.2rem] border-2 border-border bg-rose-300 shadow-[5px_5px_0px_var(--shadow-ink)] transition-transform group-hover:-translate-y-1">
        <span className="font-display text-xl font-bold tracking-[-0.05em] text-zinc-950">F</span>
      </div>
      {!compact ? (
        <div className="min-w-0">
          <p className="truncate font-display text-2xl font-bold tracking-[-0.05em]">FounderOS</p>
          <p className="truncate text-xs text-muted-foreground">AI operating system</p>
        </div>
      ) : null}
    </Link>
  );
}

function NavList({
  location,
  collapsed,
  onNavigate,
}: {
  location: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav className="space-y-1.5">
      {navItems.map((item) => {
        const current = isCurrentPath(location, item.href);
        const link = (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "nav-link",
              collapsed && "nav-link-collapsed",
              current && "nav-link-active",
              item.emphasis && !current && "bg-white/85",
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {!collapsed ? <span className="truncate">{item.label}</span> : null}
          </Link>
        );

        if (!collapsed) return link;
        return (
          <Tooltip key={item.href} delayDuration={0}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}

function SidebarBody({
  location,
  collapsed,
  notificationsCount,
  activeAgents,
  onNavigate,
}: {
  location: string;
  collapsed: boolean;
  notificationsCount: number;
  activeAgents: number;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={cn("px-4 pt-5", collapsed && "px-3")}>
        <BrandMark compact={collapsed} />
      </div>

      {!collapsed ? (
        <div className="mt-5 px-4">
          <div className="rounded-[1.5rem] border border-border bg-white/75 p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <Badge className="rounded-full border-zinc-950 bg-zinc-950 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-white">
                Headquarters
              </Badge>
              <StatusPill label="Org" value="On" tone="active" />
            </div>
            <p className="text-sm leading-6 text-slate-700">
              Sales is live and watching your pipeline. More departments are on the way.
            </p>
          </div>
        </div>
      ) : null}

      <div className={cn("mt-5 min-h-0 flex-1 overflow-y-auto px-4 pb-4 no-scrollbar", collapsed && "px-3")}>
        <NavList location={location} collapsed={collapsed} onNavigate={onNavigate} />
      </div>

      {!collapsed ? (
        <div className="border-t border-border/60 px-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border bg-amber-100/75 p-3 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-950">Unread</p>
              <p className="font-display text-2xl font-bold tracking-[-0.05em] text-zinc-950">{notificationsCount}</p>
            </div>
            <div className="rounded-2xl border border-border bg-sky-100/75 p-3 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-950">Awake</p>
              <p className="font-display text-2xl font-bold tracking-[-0.05em] text-zinc-950">{activeAgents}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: notificationsData, refetch } = useListNotifications(
    { unreadOnly: true },
    { query: { refetchInterval: 25000 } },
  );
  const { data: agentsData } = useListAgents({ query: { refetchInterval: 40000 } });
  const { data: activitiesData } = useListActivities(
    { limit: 5 },
    { query: { refetchInterval: 20000 } },
  );
  const { data: workflowsData } = useListWorkflows();
  const { data: plansData } = useQuery({
    queryKey: ["planner", "plans"],
    queryFn: async () => {
      const response = await fetch("/api/planner/plans");
      if (!response.ok) throw new Error("Failed to load plans");
      return (await response.json()) as { id: string; goal: string }[];
    },
  });
  const { mutate: markRead } = useMarkNotificationRead();
  const { mutate: markAllRead } = useMarkAllNotificationsRead();

  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isNavDrawerOpen, setIsNavDrawerOpen] = useState(false);
  const [isContextDrawerOpen, setIsContextDrawerOpen] = useState(false);

  // Persisted sidebar preference. collapsed=true → icon rail that expands on hover.
  const [collapsed, setCollapsed] = usePersistentState("founderos:sidebar-collapsed", false);
  const [hovering, setHovering] = useState(false);
  const panelExpanded = !collapsed || hovering;

  const notifications = Array.isArray(notificationsData) ? notificationsData : [];
  const agents = Array.isArray(agentsData) ? agentsData : [];
  const activities = Array.isArray(activitiesData) ? activitiesData : [];
  const workflows = Array.isArray(workflowsData) ? workflowsData : [];
  const plans = Array.isArray(plansData) ? plansData : [];

  const activeAgents = useMemo(
    () => agents.filter((agent) => agent.status === "active" || agent.status === "busy").length,
    [agents],
  );

  const isImmersive = location === "/chat";

  const handleMarkRead = useCallback(
    (id: string) => markRead({ id }, { onSuccess: () => refetch() }),
    [markRead, refetch],
  );
  const handleMarkAllRead = useCallback(
    () => markAllRead(undefined, { onSuccess: () => refetch() }),
    [markAllRead, refetch],
  );

  const pageTitle =
    location === "/" || location === "/command-center"
      ? "Command Center"
      : navItems.find((item) => isCurrentPath(location, item.href))?.label ?? "FounderOS";

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <div className="soft-grid pointer-events-none fixed inset-0" />

      {/* Desktop sidebar (>=1024px): reserves rail width; panel overlays on hover */}
      <aside
        className={cn(
          "relative z-30 hidden shrink-0 transition-[width] duration-200 ease-out lg:block",
          collapsed ? "w-[76px]" : "w-[280px]",
        )}
        onMouseEnter={() => collapsed && setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        <div
          className={cn(
            "absolute inset-y-0 left-0 flex flex-col border-r border-border/70 bg-sidebar/95 backdrop-blur-xl transition-[width] duration-200 ease-out",
            panelExpanded ? "w-[280px]" : "w-[76px]",
            collapsed && hovering && "shadow-[8px_0_30px_rgba(23,28,45,0.18)]",
          )}
        >
          <SidebarBody
            location={location}
            collapsed={!panelExpanded}
            notificationsCount={notifications.length}
            activeAgents={activeAgents}
          />
        </div>
      </aside>

      {/* Main workspace — always flex-1, never squeezed */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="z-20 shrink-0 border-b border-border/60 bg-background/85 backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
              {/* Mobile / tablet nav drawer trigger */}
              <Sheet open={isNavDrawerOpen} onOpenChange={setIsNavDrawerOpen}>
                <SheetTrigger asChild>
                  <button
                    className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-white/80 shadow-sm lg:hidden"
                    aria-label="Open navigation"
                  >
                    <PanelLeft className="h-5 w-5" />
                  </button>
                </SheetTrigger>
                <SheetContent side="left" className="w-full max-w-[300px] border-r border-border bg-sidebar p-0">
                  <SheetHeader className="sr-only">
                    <SheetTitle>Navigation</SheetTitle>
                  </SheetHeader>
                  <SidebarBody
                    location={location}
                    collapsed={false}
                    notificationsCount={notifications.length}
                    activeAgents={activeAgents}
                    onNavigate={() => setIsNavDrawerOpen(false)}
                  />
                </SheetContent>
              </Sheet>

              {/* Desktop collapse / pin toggle */}
              <button
                onClick={() => setCollapsed((value) => !value)}
                className="hidden h-10 w-10 items-center justify-center rounded-2xl border border-border bg-white/80 shadow-sm transition-transform hover:-translate-y-0.5 lg:flex"
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? <PanelLeft className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
              </button>

              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Operational pulse
                </p>
                <p className="truncate font-display text-lg font-bold tracking-[-0.05em] text-foreground sm:text-xl">
                  {pageTitle}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 rounded-full border border-border bg-white/75 px-4 py-2 text-sm text-slate-700 shadow-sm md:flex">
                <span className="pulse-dot" />
                <span>{activeAgents} awake</span>
              </div>

              {/* Notifications */}
              <Sheet open={isNotifOpen} onOpenChange={setIsNotifOpen}>
                <SheetTrigger asChild>
                  <button
                    className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-white/80 shadow-sm transition-transform hover:-translate-y-0.5"
                    aria-label="Notifications"
                  >
                    <Bell className="h-5 w-5" />
                    {notifications.length > 0 ? (
                      <span className="absolute right-2.5 top-2.5 h-2.5 w-2.5 rounded-full bg-rose-500" />
                    ) : null}
                  </button>
                </SheetTrigger>
                <SheetContent className="w-full max-w-md border-l border-border bg-background/95 p-0">
                  <SheetHeader className="border-b border-border/60 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="space-y-1">
                        <SheetTitle className="font-display text-2xl tracking-[-0.05em]">Signal Queue</SheetTitle>
                        <p className="text-sm text-muted-foreground">Operational notifications and AI prompts.</p>
                      </div>
                      {notifications.length > 0 ? (
                        <Button variant="outline" size="sm" className="rounded-full bg-white" onClick={handleMarkAllRead}>
                          Clear all
                        </Button>
                      ) : null}
                    </div>
                  </SheetHeader>
                  <div className="h-[calc(100%-96px)] overflow-y-auto">
                    <div className="space-y-3 p-5">
                      {notifications.length === 0 ? (
                        <div className="rounded-[1.75rem] border border-border bg-white/85 p-6 text-center shadow-sm">
                          <Bell className="mx-auto mb-4 h-10 w-10 text-muted-foreground/50" />
                          <p className="font-display text-2xl font-bold tracking-[-0.05em]">Quiet command floor</p>
                          <p className="mt-2 text-sm text-muted-foreground">No urgent signal is waiting for you right now.</p>
                        </div>
                      ) : (
                        notifications.map((notification) => (
                          <div key={notification.id} className="rounded-[1.5rem] border border-border bg-white/90 p-4 shadow-sm">
                            <div className="mb-2 flex items-start justify-between gap-3">
                              <div className="min-w-0 space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="pulse-dot" />
                                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                    {notification.priority}
                                  </p>
                                </div>
                                <p className="font-semibold text-slate-900">{notification.title}</p>
                              </div>
                              <button
                                onClick={() => handleMarkRead(notification.id)}
                                className="shrink-0 rounded-full border border-border bg-white p-2 text-muted-foreground transition-colors hover:text-foreground"
                                aria-label="Dismiss"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                            {notification.body ? <p className="text-sm leading-6 text-slate-700">{notification.body}</p> : null}
                            <p className="mt-3 text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </SheetContent>
              </Sheet>

              {/* Context drawer trigger — shown when rail is not inline (<1440px) and not on the immersive EA Desk */}
              <Sheet open={isContextDrawerOpen} onOpenChange={setIsContextDrawerOpen}>
                <SheetTrigger asChild>
                  <button
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-white/80 shadow-sm transition-transform hover:-translate-y-0.5 min-[1440px]:hidden",
                      isImmersive && "hidden",
                    )}
                    aria-label="Open context panel"
                  >
                    <PanelRight className="h-5 w-5" />
                  </button>
                </SheetTrigger>
                <SheetContent className="w-full max-w-sm border-l border-border bg-background/95 p-0">
                  <SheetHeader className="border-b border-border/60 p-5">
                    <SheetTitle className="font-display text-2xl tracking-[-0.05em]">Context</SheetTitle>
                  </SheetHeader>
                  <div className="h-[calc(100%-72px)] overflow-y-auto p-5">
                   <ContextRail
                       notifications={notifications}
                       agents={agents}
                       isWorking={isImmersive}
                       activities={activities}
                       workflows={workflows}
                       plans={plans}
                     />
                  </div>
                </SheetContent>
              </Sheet>

              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border-2 border-border bg-zinc-950 text-sm font-semibold text-white shadow-[4px_4px_0px_var(--shadow-ink)]">
                F
              </div>
            </div>
          </div>
        </header>

        {/* Single scroll region for standard pages; immersive pages manage their own */}
        <main className={cn("min-h-0 flex-1", isImmersive ? "overflow-hidden" : "overflow-y-auto")}>
          {isImmersive ? (
            <div className="h-full">{children}</div>
          ) : (
            <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">{children}</div>
          )}
        </main>
      </div>

      {/* Context rail — inline on wide desktop (>=1440px); hidden on the immersive EA Desk so the conversation keeps its full width */}
      {!isImmersive ? (
        <aside className="z-10 hidden w-[320px] shrink-0 overflow-y-auto border-l border-border/60 bg-background/60 px-5 py-6 backdrop-blur-xl min-[1440px]:block">
           <ContextRail
             notifications={notifications}
             agents={agents}
             isWorking={isImmersive}
             activities={activities}
             workflows={workflows}
             plans={plans}
           />
        </aside>
      ) : null}

      <FloatingVoiceMic />
    </div>
  );
}
