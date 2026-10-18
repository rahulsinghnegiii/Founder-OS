import React from 'react';
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { VoiceProvider } from "@/lib/voice/VoiceProvider";

import ExecutiveDashboard from "@/pages/executive-dashboard";
import Chat from "@/pages/chat";
import Departments from "@/pages/departments";
import SalesDesk from "@/pages/sales";
import Leads from "@/pages/leads";
import LeadDetail from "@/pages/lead-detail";
import Projects from "@/pages/projects";
import ProjectDetail from "@/pages/project-detail";
import Tasks from "@/pages/tasks";
import Activities from "@/pages/activities";
import Settings from "@/pages/settings";
import Onboarding from "@/pages/onboarding";
import ComingSoon from "@/pages/coming-soon";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Surfaces that exist in the codebase but are parked for the MVP. They
 * render a "coming soon" page instead of a half-working screen.
 */
const COMING_SOON_PATHS = [
  "/hq",
  "/command-center",
  "/agents",
  "/workflows",
  "/revenue",
  "/reports",
  "/pipeline",
  "/planner",
  "/notes",
  "/reminders",
  "/meetings",
  "/team",
];

function Router() {
  return (
    <Switch>
      {/* Onboarding gets its own layout */}
      <Route path="/onboarding" component={Onboarding} />

      {/* Main app routes wrapped in Layout */}
      <Route path="*">
        <Layout>
          <Switch>
            <Route path="/" component={ExecutiveDashboard} />
            <Route path="/chat" component={Chat} />
            <Route path="/departments" component={Departments} />
            <Route path="/sales" component={SalesDesk} />
            <Route path="/leads" component={Leads} />
            <Route path="/leads/:id" component={LeadDetail} />
            <Route path="/projects" component={Projects} />
            <Route path="/projects/:id" component={ProjectDetail} />
            <Route path="/tasks" component={Tasks} />
            <Route path="/activities" component={Activities} />
            <Route path="/settings" component={Settings} />
            {COMING_SOON_PATHS.map((path) => (
              <Route key={path} path={path} component={ComingSoon} />
            ))}
            <Route component={NotFound} />
          </Switch>
        </Layout>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <VoiceProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </VoiceProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
