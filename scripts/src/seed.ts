import { db } from "@workspace/db";
import {
  departmentsTable,
  agentsTable,
  projectsTable,
  tasksTable,
  leadsTable,
  workflowsTable,
  notificationsTable,
  revenueTable,
  opportunitiesTable,
} from "@workspace/db";

async function seed() {
  console.log("Seeding FounderOS demo data...");

  // Departments
  const [salesDept, engDept, mktDept, opsDept] = await db
    .insert(departmentsTable)
    .values([
      { name: "Sales", slug: "sales", description: "Revenue generation and lead conversion" },
      { name: "Engineering", slug: "engineering", description: "Product development and technical execution" },
      { name: "Marketing", slug: "marketing", description: "Brand awareness and demand generation" },
      { name: "Operations", slug: "operations", description: "Systems, processes, and infrastructure" },
    ])
    .returning()
    .onConflictDoNothing();

  if (!salesDept) { console.log("Data already seeded, skipping."); return; }

  // Agents
  await db.insert(agentsTable).values([
    { name: "Alex — Sales Intelligence", slug: "alex-sales", departmentId: salesDept.id, description: "Identifies and qualifies leads, scores prospects, drafts outreach", status: "active", modelTier: "standard", capabilities: ["lead_scoring", "email_outreach", "crm_updates", "proposal_drafting"] },
    { name: "Max — Growth Engine", slug: "max-growth", departmentId: mktDept.id, description: "Runs market analysis, content strategy, and campaign optimization", status: "idle", modelTier: "premium", capabilities: ["market_research", "content_generation", "seo_analysis", "competitor_tracking"] },
    { name: "Jordan — Build Ops", slug: "jordan-eng", departmentId: engDept.id, description: "Tracks technical tasks, manages sprints, identifies blockers", status: "busy", modelTier: "standard", capabilities: ["task_management", "code_review", "sprint_planning", "bug_triage"] },
    { name: "Riley — Ops Commander", slug: "riley-ops", departmentId: opsDept.id, description: "Orchestrates workflows, monitors systems, manages automations", status: "active", modelTier: "lightweight", capabilities: ["workflow_automation", "system_monitoring", "process_optimization", "reporting"] },
    { name: "Sam — Finance Analyst", slug: "sam-finance", departmentId: opsDept.id, description: "Tracks revenue, forecasts cash flow, analyzes deal economics", status: "idle", modelTier: "standard", capabilities: ["revenue_tracking", "forecasting", "deal_analysis", "budget_monitoring"] },
  ]).onConflictDoNothing();

  // Projects
  const [proj1, proj2, proj3] = await db.insert(projectsTable).values([
    { title: "Q3 Revenue Push", description: "Close 5 enterprise deals and expand 3 existing accounts to hit $120k ARR target", status: "active", priority: "critical", startDate: "2026-05-01", dueDate: "2026-08-31" },
    { title: "Product v2 Launch", description: "Ship the redesigned core product with agent orchestration and improved onboarding", status: "active", priority: "high", startDate: "2026-04-15", dueDate: "2026-07-15" },
    { title: "GTM Playbook", description: "Build repeatable go-to-market motion with documented ICP, messaging, and outbound sequences", status: "planning", priority: "medium", startDate: "2026-06-01", dueDate: "2026-09-01" },
    { title: "Infrastructure Scale-Up", description: "Migrate to multi-region deployment and establish 99.9% uptime SLA", status: "on_hold", priority: "high", dueDate: "2026-10-01" },
  ]).returning().onConflictDoNothing();

  // Tasks
  await db.insert(tasksTable).values([
    { projectId: proj1?.id, title: "Send proposals to Acme Corp and TechFlow", status: "in_progress", priority: "critical" },
    { projectId: proj1?.id, title: "Schedule demo calls with 3 qualified leads", status: "todo", priority: "high" },
    { projectId: proj1?.id, title: "Update CRM with all Q2 meeting notes", status: "done", priority: "medium" },
    { projectId: proj1?.id, title: "Negotiate contract terms with DataCo", status: "review", priority: "critical" },
    { projectId: proj2?.id, title: "Finalize agent orchestration architecture", status: "done", priority: "critical" },
    { projectId: proj2?.id, title: "Build onboarding wizard flow", status: "in_progress", priority: "high" },
    { projectId: proj2?.id, title: "Write API documentation", status: "todo", priority: "medium" },
    { projectId: proj2?.id, title: "Performance testing — 1000 concurrent users", status: "todo", priority: "high" },
    { projectId: proj3?.id, title: "Define Ideal Customer Profile (ICP)", status: "in_progress", priority: "high" },
    { projectId: proj3?.id, title: "Write 5 cold email sequences", status: "todo", priority: "medium" },
    { title: "Review investor update draft", status: "todo", priority: "high" },
    { title: "Prepare board deck for Q3", status: "todo", priority: "medium" },
  ]).onConflictDoNothing();

  // Leads
  const [lead1, lead2, lead3] = await db.insert(leadsTable).values([
    { name: "Sarah Chen", email: "sarah@nexuslabs.io", company: "Nexus Labs", status: "qualified", score: 87, sentiment: "positive", estimatedValue: "45000", source: "inbound", notes: "CTO at Series A startup, evaluating FounderOS for team of 12. Hot lead — demo scheduled." },
    { name: "Marcus Webb", email: "m.webb@dataflow.com", company: "DataFlow Inc", status: "proposal", score: 92, sentiment: "positive", estimatedValue: "78000", source: "referral", notes: "VP of Product, referred by existing customer. Proposal sent 3 days ago, awaiting response." },
    { name: "Priya Sharma", email: "priya@scalevault.com", company: "Scale Vault", status: "contacted", score: 64, sentiment: "neutral", estimatedValue: "22000", source: "outbound", notes: "Founder of bootstrapped SaaS, budget conscious but high potential for expansion." },
    { name: "Tom Bradley", email: "tom@acmecorp.io", company: "Acme Corp", status: "new", score: 45, sentiment: "neutral", estimatedValue: "15000", source: "linkedin", notes: "Downloaded whitepaper, not yet engaged in conversation." },
    { name: "Elena Rodriguez", email: "elena@techflow.ai", company: "TechFlow AI", status: "won", score: 95, sentiment: "positive", estimatedValue: "60000", source: "conference", notes: "Closed! Annual contract signed. Onboarding starts June 1." },
    { name: "James Kim", email: "james@launchpad.co", company: "LaunchPad", status: "lost", score: 30, sentiment: "negative", estimatedValue: "12000", source: "outbound", notes: "Went with competitor due to pricing. Potential re-engagement in 6 months." },
  ]).returning().onConflictDoNothing();

  // Opportunities
  await db.insert(opportunitiesTable).values([
    { leadId: lead1?.id, title: "Nexus Labs — Enterprise License", status: "pursuing", value: "45000", probability: 75, expectedCloseDate: "2026-07-30", description: "12-seat enterprise license with custom agent configuration" },
    { leadId: lead2?.id, title: "DataFlow Inc — Platform Deal", status: "pursuing", value: "78000", probability: 85, expectedCloseDate: "2026-06-30", description: "Annual platform deal with dedicated agent deployment" },
    { leadId: lead3?.id, title: "Scale Vault — Starter Package", status: "evaluating", value: "22000", probability: 40, expectedCloseDate: "2026-08-15", description: "3-seat starter package with growth expansion clause" },
    { title: "Referral Network Expansion", status: "identified", value: "150000", probability: 30, description: "Systematic referral program through existing customer base" },
  ]).onConflictDoNothing();

  // Workflows
  await db.insert(workflowsTable).values([
    { name: "New Lead Notification", triggerEvent: "lead.created", isActive: true, runCount: 23, steps: [{ type: "notify", channel: "dashboard", message: "New lead added: {{lead.name}} from {{lead.company}}" }, { type: "assign_score", agent: "alex-sales" }] },
    { name: "Proposal Follow-Up Sequence", triggerEvent: "proposal.sent", isActive: true, runCount: 8, steps: [{ type: "wait", duration: "3d" }, { type: "notify", priority: "high", message: "Follow up on proposal for {{lead.name}}" }] },
    { name: "Weekly Revenue Summary", triggerEvent: "schedule.weekly", isActive: true, runCount: 12, steps: [{ type: "generate_report", reportType: "revenue" }, { type: "notify", channel: "dashboard" }] },
    { name: "Deal Won Celebration", triggerEvent: "lead.won", isActive: true, runCount: 5, steps: [{ type: "notify", priority: "high", message: "Deal closed! {{lead.name}} is now a customer." }, { type: "create_project", template: "onboarding" }] },
    { name: "Overdue Task Escalation", triggerEvent: "schedule.daily", isActive: false, runCount: 0, steps: [{ type: "check_overdue_tasks" }, { type: "notify", priority: "urgent" }] },
  ]).onConflictDoNothing();

  // Notifications
  await db.insert(notificationsTable).values([
    { type: "lead_update", title: "Hot lead ready for follow-up", body: "Marcus Webb has viewed your proposal twice in the last 24 hours. Time to call.", priority: "urgent", isRead: false, actionUrl: "/leads" },
    { type: "deal_alert", title: "Deal closing window — DataFlow Inc", body: "Proposal expires in 3 days. Schedule a close call now.", priority: "high", isRead: false, actionUrl: "/pipeline" },
    { type: "task_overdue", title: "2 tasks are past due", body: "\"Negotiate contract terms with DataCo\" and \"Schedule demo calls\" need attention.", priority: "high", isRead: false, actionUrl: "/tasks" },
    { type: "agent_report", title: "Alex completed lead scoring", body: "Sales agent scored 6 new leads. 2 rated high-priority.", priority: "medium", isRead: false },
    { type: "workflow", title: "Weekly revenue report generated", body: "Your Q2 revenue summary is ready to review.", priority: "low", isRead: true },
    { type: "system", title: "FounderOS is fully operational", body: "All 5 agents are online. Workflows are running. Command center is ready.", priority: "low", isRead: true },
  ]).onConflictDoNothing();

  // Revenue
  const today = new Date();
  const fmt = (offset: number) => {
    const d = new Date(today);
    d.setMonth(d.getMonth() + offset);
    return d.toISOString().slice(0, 10);
  };
  await db.insert(revenueTable).values([
    { leadId: lead3?.id ?? null, type: "one_time", amount: "60000", status: "received", date: fmt(-2), description: "TechFlow AI — annual license (closed)" },
    { type: "recurring", amount: "8500", status: "received", date: fmt(-1), description: "Recurring MRR from existing customers" },
    { type: "recurring", amount: "9200", status: "received", date: fmt(0), description: "MRR — May 2026" },
    { leadId: lead2?.id ?? null, type: "one_time", amount: "78000", status: "invoiced", date: fmt(0), description: "DataFlow Inc — pending signature" },
    { leadId: lead1?.id ?? null, type: "one_time", amount: "45000", status: "projected", date: fmt(1), description: "Nexus Labs — deal in progress" },
    { type: "recurring", amount: "12000", status: "projected", date: fmt(1), description: "Projected MRR growth — June" },
    { type: "recurring", amount: "15000", status: "projected", date: fmt(2), description: "Projected MRR — July" },
    { type: "one_time", amount: "22000", status: "projected", date: fmt(2), description: "Scale Vault — potential close" },
  ]).onConflictDoNothing();

  console.log("Seed complete!");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
