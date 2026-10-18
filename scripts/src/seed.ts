import "./loadEnv";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  departmentsTable,
  agentsTable,
  projectsTable,
  tasksTable,
  leadsTable,
  proposalsTable,
  followUpsTable,
  workflowsTable,
  notificationsTable,
  revenueTable,
  opportunitiesTable,
} from "@workspace/db";

const DEMO = process.argv.includes("--demo") || process.env.SEED_DEMO === "1";
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

async function seed() {
  console.log("Resetting FounderOS data...");

  // Operational tables are cleared on every seed so the UI only ever shows
  // real records (or an intentional empty state). Departments + agents are
  // the system's own structure and are upserted in place.
  await db.delete(followUpsTable);
  await db.delete(proposalsTable);
  await db.delete(opportunitiesTable);
  await db.delete(revenueTable);
  await db.delete(notificationsTable);
  await db.delete(workflowsTable);
  await db.delete(tasksTable);
  await db.delete(projectsTable);
  await db.delete(leadsTable);

  // Departments — MVP scope: Executive Assistant + Sales are live, the rest
  // are visible as "coming soon" (isActive=false) and never receive work.
  const departments = [
    { name: "Executive Assistant", slug: "executive-assistant", description: "Orchestrates every request, keeps context, and routes work to the right department.", isActive: true },
    { name: "Sales", slug: "sales", description: "Watches the pipeline, flags deals going quiet, drafts follow-ups, and scores new leads.", isActive: true },
    { name: "Marketing", slug: "marketing", description: "Positioning, content, and growth experiments.", isActive: false },
    { name: "Operations", slug: "operations", description: "Projects, tasks, deadlines, and execution health.", isActive: false },
    { name: "Strategy", slug: "strategy", description: "Bottlenecks, opportunities, and recommendations.", isActive: false },
  ];

  for (const dept of departments) {
    await db
      .insert(departmentsTable)
      .values(dept)
      .onConflictDoUpdate({
        target: departmentsTable.slug,
        set: { name: dept.name, description: dept.description, isActive: dept.isActive, updatedAt: sql`now()` },
      });
  }

  // Retire departments from older seeds that no longer exist in the MVP.
  const keepSlugs = departments.map((d) => d.slug);
  const allDepartments = await db.select().from(departmentsTable);
  for (const dept of allDepartments) {
    if (!keepSlugs.includes(dept.slug) && dept.isActive) {
      await db.update(departmentsTable).set({ isActive: false }).where(sql`${departmentsTable.id} = ${dept.id}`);
    }
  }

  const deptBySlug = Object.fromEntries(allDepartments.map((d) => [d.slug, d]));

  // Agents (system structure — required for orchestrator / Sales agent).
  const agents = [
    { name: "EA — Executive Assistant", slug: "ea", departmentId: deptBySlug["executive-assistant"].id, description: "Your right hand. Coordinates departments and keeps the company's memory.", status: "active", modelTier: "standard", capabilities: ["orchestration", "memory", "task_capture", "lead_capture"] },
    { name: "Alex — Sales Intelligence", slug: "alex-sales", departmentId: deptBySlug["sales"].id, description: "Scans the pipeline for deals going quiet, drafts follow-ups, scores leads, and schedules proposal nudges.", status: "idle", modelTier: "standard", capabilities: ["stale_deal_detection", "follow_up_drafting", "lead_scoring", "proposal_follow_through"] },
    { name: "Max — Growth Engine", slug: "max-growth", departmentId: deptBySlug["marketing"].id, description: "Coming soon: market analysis, content strategy, campaign optimization.", status: "offline", modelTier: "premium", capabilities: ["market_research", "content_generation"] },
    { name: "Riley — Ops Commander", slug: "riley-ops", departmentId: deptBySlug["operations"].id, description: "Coming soon: workflow automation, deadline tracking, execution health.", status: "offline", modelTier: "lightweight", capabilities: ["workflow_automation", "deadline_tracking"] },
    { name: "Sam — Strategy Analyst", slug: "sam-strategy", departmentId: deptBySlug["strategy"].id, description: "Coming soon: bottleneck detection, opportunity surfacing, recommendations.", status: "offline", modelTier: "standard", capabilities: ["bottleneck_detection", "opportunity_surfacing"] },
  ];

  for (const agent of agents) {
    await db
      .insert(agentsTable)
      .values(agent)
      .onConflictDoUpdate({
        target: agentsTable.slug,
        set: {
          name: agent.name,
          departmentId: agent.departmentId,
          description: agent.description,
          status: agent.status,
          modelTier: agent.modelTier,
          capabilities: agent.capabilities,
          updatedAt: sql`now()`,
        },
      });
  }

  // Agents from older seeds that no longer have a department go offline.
  const agentSlugs = agents.map((a) => a.slug);
  const allAgents = await db.select().from(agentsTable);
  for (const agent of allAgents) {
    if (!agentSlugs.includes(agent.slug)) {
      await db.update(agentsTable).set({ status: "offline" }).where(sql`${agentsTable.id} = ${agent.id}`);
    }
  }

  if (DEMO) {
    console.log("Seeding demo pipeline (--demo)...");
    const leads = await db
      .insert(leadsTable)
      .values([
        { name: "Priya Sharma", company: "Nimbus Labs", email: "priya@nimbuslabs.io", status: "qualified", source: "referral", score: 78, sentiment: "positive", estimatedValue: "18000", notes: "Wants a pilot in Q4. Asked for two case studies and pricing for 10 seats.", lastContactedAt: daysAgo(9), createdAt: daysAgo(21) },
        { name: "Daniel Reyes", company: "Harbor Freight Logistics", email: "daniel.reyes@harborfreight.co", status: "proposal", source: "inbound", score: 84, sentiment: "positive", estimatedValue: "32000", notes: "Proposal covers warehouse automation pilot. Decision maker is the COO.", lastContactedAt: daysAgo(6), createdAt: daysAgo(30) },
        { name: "Mei Tanaka", company: "Orbit Studio", email: "mei@orbit.studio", status: "contacted", source: "conference", score: 55, sentiment: "neutral", estimatedValue: "7500", notes: "Met at SaaStr. Interested but budget cycle starts next quarter.", lastContactedAt: daysAgo(2), createdAt: daysAgo(8) },
        { name: "Tom Becker", company: "Becker & Co", email: "tom@beckerco.com", status: "new", source: "website", score: 42, estimatedValue: "4000", notes: "Filled out the demo form. No reply to the intro email yet.", lastContactedAt: null, createdAt: daysAgo(5) },
        { name: "Sofia Alvarez", company: "Greenline Energy", email: "sofia@greenline.energy", status: "won", source: "referral", score: 95, sentiment: "positive", estimatedValue: "25000", notes: "Signed annual plan. Kickoff scheduled.", lastContactedAt: daysAgo(10), createdAt: daysAgo(45) },
        { name: "Arjun Mehta", company: "Stackline", email: "arjun@stackline.dev", status: "qualified", source: "linkedin", score: 70, sentiment: "positive", estimatedValue: "12000", notes: "Technical evaluation in progress with their eng lead.", lastContactedAt: daysAgo(1), createdAt: daysAgo(14) },
        { name: "Lena Fischer", company: "Kite Analytics", email: "lena@kite.io", status: "lost", source: "cold outreach", score: 20, sentiment: "negative", estimatedValue: "9000", notes: "Went with an incumbent vendor.", lastContactedAt: daysAgo(20), createdAt: daysAgo(40) },
        { name: "Omar Haddad", company: "Pulse Health", email: "omar@pulsehealth.com", status: "contacted", source: "referral", score: 61, sentiment: "neutral", estimatedValue: "15000", notes: "Had a discovery call. Said he'd loop in his CTO.", lastContactedAt: daysAgo(12), createdAt: daysAgo(25) },
      ])
      .returning();

    const daniel = leads.find((l) => l.name === "Daniel Reyes");
    const sofia = leads.find((l) => l.name === "Sofia Alvarez");

    await db.insert(proposalsTable).values([
      { leadId: daniel?.id, title: "Warehouse automation pilot — Harbor Freight", status: "sent", value: "32000", content: "90-day pilot across two warehouses with weekly reporting.", sentAt: daysAgo(6), createdAt: daysAgo(7) },
      { leadId: sofia?.id, title: "Greenline Energy annual plan", status: "accepted", value: "25000", content: "Annual plan, 25 seats.", sentAt: daysAgo(18), responseAt: daysAgo(12), createdAt: daysAgo(19) },
    ]);

    await db.insert(tasksTable).values([
      { title: "Send Priya the two case studies she asked for", description: "Nimbus Labs pilot — she wanted the fintech and logistics case studies.", priority: "high", status: "todo", dueDate: daysAgo(-1) },
      { title: "Prep kickoff deck for Greenline Energy", priority: "medium", status: "in_progress", dueDate: daysAgo(-4) },
    ]);
  }

  console.log(
    `Seed complete — ${DEMO ? "demo pipeline loaded; " : "operational tables cleared; "}departments and agents initialized (Sales + EA live, others coming soon).`,
  );
}

seed()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
