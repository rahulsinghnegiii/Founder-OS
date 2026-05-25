import React from 'react';
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";

import Dashboard from "@/pages/dashboard";
import Chat from "@/pages/chat";
import Projects from "@/pages/projects";
import ProjectDetail from "@/pages/project-detail";
import Tasks from "@/pages/tasks";
import Leads from "@/pages/leads";
import LeadDetail from "@/pages/lead-detail";
import Pipeline from "@/pages/pipeline";
import Agents from "@/pages/agents";
import Workflows from "@/pages/workflows";
import Revenue from "@/pages/revenue";
import Activities from "@/pages/activities";
import Reports from "@/pages/reports";
import Settings from "@/pages/settings";
import Onboarding from "@/pages/onboarding";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      {/* Onboarding gets its own layout */}
      <Route path="/onboarding" component={Onboarding} />
      
      {/* Main app routes wrapped in Layout */}
      <Route path="*">
        <Layout>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/chat" component={Chat} />
            <Route path="/projects" component={Projects} />
            <Route path="/projects/:id" component={ProjectDetail} />
            <Route path="/tasks" component={Tasks} />
            <Route path="/leads" component={Leads} />
            <Route path="/leads/:id" component={LeadDetail} />
            <Route path="/pipeline" component={Pipeline} />
            <Route path="/agents" component={Agents} />
            <Route path="/workflows" component={Workflows} />
            <Route path="/revenue" component={Revenue} />
            <Route path="/activities" component={Activities} />
            <Route path="/reports" component={Reports} />
            <Route path="/settings" component={Settings} />
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
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
