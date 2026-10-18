import { logActivity } from "../lib/activity-logger";
import { publishOperationalEvent } from "../lib/event-bus";
import { agentRuntime, type AgentDelegationTask } from "./agent-runtime";
import { memoryService } from "./memory-service";
import { operationalIntelligenceService } from "./operational-intelligence";
import { createOperationalNotification } from "./notification-service";
import { warRoomService } from "./war-room-service";
import { salesAgent } from "./sales-agent";
import { getFounderName, founderPossessive } from "../lib/founder";
import { ilike } from "drizzle-orm";
import { db, leadsTable } from "@workspace/db";
import { callAI } from "../lib/ai";
import { logger } from "../lib/logger";
import { z } from "zod/v4";
import { toolRegistry } from "../lib/tools/registry";
import { runTool } from "../lib/tools/pipeline";
import "../lib/tools/builtin";
import { conversationRepository } from "./conversation-repository";
import { conversationService } from "./conversation-service";
import type { PendingAction } from "./conversation-types";

/**
 * MVP scope: only the Executive Assistant and Sales are live. Other
 * departments exist as "coming soon" cards and never receive delegations.
 */
const ENABLED_DEPARTMENTS = new Set(["Executive Assistant", "Sales"]);

function normalizeDepartment(name: string): string {
  const n = name.trim().toLowerCase();
  if (n.includes("sales")) return "Sales";
  if (n.includes("executive") || n.includes("assistant") || n === "ea") return "Executive Assistant";
  if (n.includes("market") || n.includes("growth")) return "Marketing";
  if (n.includes("ops") || n.includes("operation")) return "Operations";
  if (n.includes("strateg") || n.includes("research") || n.includes("product")) return "Strategy";
  if (n.includes("financ")) return "Finance";
  return name.trim();
}

type IntentAnalysis = {
  primaryIntent: string;
  departments: string[];
  unavailableDepartments: string[];
  priority: "low" | "medium" | "high" | "urgent";
  relatedEntities: Array<{ entityType: string; entityId?: string | null }>;
  plan: string;
};

async function analyzeIntent(message: string, context: string): Promise<IntentAnalysis> {
  try {
    const result = await callAI(
      [
        {
          role: "system",
          content: `You are the Intent Analysis engine for FounderOS. Your job is to analyze a founder's message and current operational context to determine routing and priority.
          Live departments: Executive Assistant, Sales. Not yet available (list them anyway if the founder clearly wants them): Marketing, Operations, Strategy.
          Return a JSON object:
          {
            "primaryIntent": "briefing" | "planning" | "execution_support" | "founder_request",
            "departments": ["..."],
            "priority": "low" | "medium" | "high" | "urgent",
            "relatedEntities": [{"entityType": "...", "entityId": "..."}],
            "plan": "A concise internal explanation of how you are routing this."
          }`,
        },
        {
          role: "user",
          content: `Context:\n${context}\n\nMessage: ${message}`,
        },
      ],
      { jsonMode: true },
    );

    const parsed = JSON.parse(result.reply);
    logger.info({ parsed }, "Intent analysis parsed result");

    if (!parsed || typeof parsed !== "object") {
      throw new Error("Intent analysis did not return an object");
    }

    const requested: string[] = (Array.isArray(parsed.departments) ? parsed.departments : ["Executive Assistant"])
      .filter((d: unknown): d is string => typeof d === "string")
      .map(normalizeDepartment);
    const enabled = [...new Set(requested.filter((d) => ENABLED_DEPARTMENTS.has(d)))];
    const unavailable = [...new Set(requested.filter((d) => !ENABLED_DEPARTMENTS.has(d)))];

    return {
      primaryIntent: parsed.primaryIntent ?? "founder_request",
      departments: enabled.length ? enabled : ["Executive Assistant"],
      unavailableDepartments: unavailable,
      priority: ["low", "medium", "high", "urgent"].includes(parsed.priority) ? parsed.priority : "medium",
      relatedEntities: Array.isArray(parsed.relatedEntities) ? parsed.relatedEntities : [],
      plan: typeof parsed.plan === "string" ? parsed.plan : "Routing to Executive Assistant",
    };
  } catch (err) {
    logger.error({ err }, "AI intent analysis failed, falling back to basic analysis.");
    return {
      primaryIntent: "founder_request",
      departments: ["Executive Assistant"],
      unavailableDepartments: [],
      priority: "medium",
      relatedEntities: [],
      plan: "Fallback: Routing to Executive Assistant due to analysis failure.",
    };
  }
}

function buildDelegations(message: string, intent: IntentAnalysis, memoryContext: string): AgentDelegationTask[] {
  return intent.departments.map((department) => ({
    department,
    objective: message,
    priority: intent.priority,
    context: `Intent=${intent.primaryIntent}. Founder message="${message}"`,
    memoryContext,
    relatedEntities: intent.relatedEntities,
    trigger: "founder_request",
  }));
}

async function buildFounderResponse(params: {
  message: string;
  intent: IntentAnalysis;
  agentOutputs: Awaited<ReturnType<typeof agentRuntime.executeDelegation>>[];
  briefingSummary: string;
  memoryContext: string;
}): Promise<string> {
  const agentResults = params.agentOutputs
    .map((o) => `[${o.department} Agent]: ${o.summary}`)
    .join("\n");

  try {
    const result = await callAI([
      {
        role: "system",
        content: `You are a founder's Executive Assistant. Respond like a sharp human — 1–3 short sentences max. No lists, no fluff, no format. Speak naturally.
        Briefing: ${params.briefingSummary}
        Context: ${params.memoryContext}`,
      },
      {
        role: "user",
        content: `Founder Message: ${params.message}\n\nAgent Results:\n${agentResults}`,
      },
    ]);
    return result.reply;
  } catch (err) {
    logger.error({ err }, "Failed to build AI response, falling back to basic summary.");
    const executionSummary = params.agentOutputs.map((output) => `${output.department}: ${output.summary}`).join(" ");
    return `${params.briefingSummary} ${executionSummary}`.trim();
  }
}

const CommandDetectionSchema = z.object({
  command: z
    .object({ tool: z.string(), args: z.record(z.string(), z.unknown()) })
    .nullable(),
});

/**
 * Ask the AI router to interpret a founder message as a direct tool command.
 * Returns the detected { tool, args } or null. Never throws.
 */
async function detectCommand(
  message: string,
): Promise<{ tool: string; args: Record<string, unknown> } | null> {
  try {
    const result = await callAI(
      [
        {
          role: "system",
          content: `You are the FounderOS Command Interpreter. Decide whether the founder's message is a direct instruction to perform an action using one of the available tools.

Available tools:
${toolRegistry.discoveryPrompt()}

Rules:
- If the message is a clear action command that matches an available tool, respond ONLY in JSON: {"command":{"tool":"<tool.name>","args":{...}}}.
- If the message is a question, a chat, or cannot be fulfilled by an available tool, respond ONLY in JSON: {"command":null}.
- Use the exact tool name and exact parameter names from the list above.
- Do not invent tools that are not listed.`,
        },
        { role: "user", content: message },
      ],
      { jsonMode: true },
    );

    const parsed = CommandDetectionSchema.safeParse(JSON.parse(result.reply));
    if (!parsed.success) return null;

    const cmd = parsed.data.command;
    if (!cmd || !toolRegistry.has(cmd.tool)) return null;

    return cmd;
  } catch (err) {
    logger.error({ err }, "Command detection failed, treating as conversation");
    return null;
  }
}

type MessageCategory = "greeting" | "small_talk" | "question" | "command" | "planning" | "sales_query";

/** Questions the Sales agent answers directly from pipeline data. */
function isSalesQuery(m: string): boolean {
  return /(stale|quiet|going cold|gone cold|cold lead|cooling off|pipeline|follow[- ]?ups?|deals? at risk|at[- ]risk|which (deals?|leads?|prospects?)|my (deals?|leads?|prospects?)|open deals?|proposals? (status|outstanding|waiting|pending)|who should i (follow|chase|call|email|ping)|chase|sales (desk|update|status|brief|summary)|how('s| is) (the )?(pipeline|sales)|draft (a |an )?(follow[- ]?up|email|message|note) (for|to) )/.test(
    m,
  );
}

/**
 * Lightweight, rule-based classification that runs BEFORE any AI call.
 * This is what keeps greetings and small talk fast: they never touch the
 * briefing engine, planner, or war room.
 */
function classifyMessage(message: string): MessageCategory {
  const m = message.trim().toLowerCase();
  if (!m) return "question";

  if (/^(hi|hii|hey|heya|hello|hallo|halo|hiya|howdy|yo|sup|greetings|good\s*morning|good\s*afternoon|good\s*evening|hi\s*there|hey\s*there|hello\s*there|morning|afternoon|evening)[\s!.,?]*$/.test(m)) {
    return "greeting";
  }

  if (/(how are you|how're you|how r u|how are things|how's it going|how is it going|how have you been|how's everything|what's up|whats up|what is up|thanks|thank you|thx|cheers|nice|cool|awesome|great|sounds good|sounds great|i appreciate|appreciate it|love it|perfect|amazing|not much|same old|doing well|i'm good|i am good|you good)/.test(m)) {
    return "small_talk";
  }

  if (isSalesQuery(m)) {
    return "sales_query";
  }

  if (/(^|\b)(create\s+(a |an |new |the )?task|add\s+(a |an |new |the )?task|new task|make\s+a\s+task|delete\s+(a |the )?task|remove\s+(a |the )?task|complete\s+(a |the )?task|create\s+(a |an |new |the )?department|add\s+(a |an |new |the )?department|rename\s+(a |the )?department|delete\s+(a |the )?department|remind me|set\s+a\s+reminder|set reminder|create reminder|send (a |the )?(message|email)|schedule (a |the )?)/.test(m)) {
    return "command";
  }

  if (/(launch|road ?map|build|create (a |an )?plan|make (a |an )?plan|strateg|execution plan|execute|roll ?out|ship|deploy|set ?up|kick ?off|kickoff|founderos|founder os|new initiative|new project|grow (our|the|my|revenue|business)|scale|initiative|campaign|marketing plan|growth plan|quarterly plan|q[1-4] (plan|strategy)|milestone|objective|okr)/.test(m)) {
    return "planning";
  }

  if (/(^|\b)(what|why|how|who|where|when|which|explain|tell me|describe|define|can you|could you|is |are |do (you|we|i)|does |should |would |isn't|aren't|won't|list |show me|give me)\b|\?/.test(m)) {
    return "question";
  }

  return "question";
}

export type WorkflowStep = {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "date";
  placeholder?: string;
  options?: string[];
  required?: boolean;
};

export type WorkflowSpec = {
  tool: string;
  title: string;
  description?: string;
  steps: WorkflowStep[];
};

/**
 * Deterministic (no AI) recognition of "I want to create X" intents.
 * When the founder signals a create-action but hasn't supplied the details,
 * we return a workflow spec so the UI can collect them inline (one field at a
 * time) instead of the AI asking a wall of questions in chat.
 */
function detectWorkflow(message: string): WorkflowSpec | null {
  const m = message.toLowerCase();

  const leadMatch = /\b(lead|prospect|contact|crm|i met|met (someone|them)|got (a |their )?referral|referral)\b/.test(m);
  const projectMatch = /\b(project|initiative)\b/.test(m);
  const taskMatch = /\b(task|to-?do|to do)\b/.test(m);
  const departmentMatch = /\b(department)\b/.test(m);

  if (leadMatch) {
    return {
      tool: "lead.create",
      title: "Capture a new lead",
      description: "A few quick details and I'll drop them into your CRM.",
      steps: [
        { key: "name", label: "Full name", type: "text", placeholder: "Sarah Connor", required: true },
        { key: "company", label: "Company", type: "text", placeholder: "Cyberdyne Systems" },
        { key: "email", label: "Email", type: "text", placeholder: "sarah@cyberdyne.com" },
        { key: "phone", label: "Phone", type: "text", placeholder: "+1 555 0100" },
        { key: "source", label: "How did you meet them?", type: "text", placeholder: "Conference / referral / cold" },
        { key: "estimatedValue", label: "Estimated value (optional)", type: "text", placeholder: "5000" },
      ],
    };
  }

  if (projectMatch) {
    return {
      tool: "project.create",
      title: "Start a new project",
      description: "What are we launching?",
      steps: [
        { key: "title", label: "Project title", type: "text", placeholder: "Q3 Growth Sprint", required: true },
        { key: "description", label: "What is this about?", type: "textarea", placeholder: "Short description" },
        { key: "priority", label: "Priority", type: "select", options: ["low", "medium", "high", "critical"] },
        { key: "status", label: "Status", type: "select", options: ["planning", "active", "on_hold", "completed", "cancelled"] },
        { key: "startDate", label: "Start date", type: "date" },
        { key: "dueDate", label: "Due date", type: "date" },
      ],
    };
  }

  if (taskMatch) {
    return {
      tool: "task.create",
      title: "Create a task",
      description: "One quick line and I'll log it.",
      steps: [
        { key: "title", label: "Task", type: "text", placeholder: "Finish the investor deck", required: true },
        { key: "description", label: "Details (optional)", type: "textarea" },
        { key: "priority", label: "Priority", type: "select", options: ["low", "medium", "high", "critical"] },
        { key: "dueDate", label: "Due date (optional)", type: "date" },
      ],
    };
  }

  if (departmentMatch) {
    return {
      tool: "department.create",
      title: "Create a department",
      description: "Name the new team.",
      steps: [
        { key: "name", label: "Department name", type: "text", placeholder: "Partnerships", required: true },
        { key: "description", label: "What does it own?", type: "textarea" },
      ],
    };
  }

  const reminderMatch = /\b(remind|reminder|remind me|set a reminder|don't let me forget)\b/.test(m);
  const meetingMatch = /\b(meeting|book (a |time|a call)|schedule (a |time)|catch up|sync up|hop on a call|call with|call me)\b/.test(m);
  const noteMatch = /\b(note|remember|jot|note down|make a note|take a note|keep a note)\b/.test(m);
  const teamMatch = /\b(team member|hire|invite|onboard|add (a |the )?(new )?(team )?member|new (team )?member|add (someone|them) to (the )?team)\b/.test(m);

  if (reminderMatch) {
    return {
      tool: "reminder.create",
      title: "Set a reminder",
      description: "What should I remind you about?",
      steps: [
        { key: "title", label: "Remind me to", type: "text", placeholder: "Follow up with the investor", required: true },
        { key: "note", label: "Notes (optional)", type: "textarea" },
        { key: "dueAt", label: "When (optional)", type: "date" },
      ],
    };
  }

  if (meetingMatch) {
    return {
      tool: "meeting.create",
      title: "Schedule a meeting",
      description: "Let's get it on the calendar.",
      steps: [
        { key: "title", label: "What's it about", type: "text", placeholder: "Weekly sync", required: true },
        { key: "attendee", label: "With whom?", type: "text", placeholder: "Sarah from Acme" },
        { key: "scheduledAt", label: "When", type: "date" },
        { key: "location", label: "Where / link", type: "text", placeholder: "Zoom" },
      ],
    };
  }

  if (noteMatch) {
    return {
      tool: "note.create",
      title: "Capture a note",
      description: "What should I remember?",
      steps: [
        { key: "content", label: "Note", type: "textarea", placeholder: "Key decision from today's call…", required: true },
        { key: "title", label: "Title (optional)", type: "text", placeholder: "Q3 positioning" },
      ],
    };
  }

  if (teamMatch) {
    return {
      tool: "team-member.create",
      title: "Add a team member",
      description: "Who are we bringing on?",
      steps: [
        { key: "name", label: "Full name", type: "text", placeholder: "Jordan Lee", required: true },
        { key: "role", label: "Role", type: "text", placeholder: "Growth Lead" },
        { key: "email", label: "Email", type: "text", placeholder: "jordan@company.com" },
        { key: "department", label: "Department", type: "text", placeholder: "Marketing" },
      ],
    };
  }

  return null;
}

/**
 * Field definitions for every entity the founder can create via conversation.
 * Drives slot-filling: we collect these one at a time instead of interrogating.
 */
const CREATABLE: Record<string, { fields: Array<{ key: string; required: boolean }> }> = {
  "lead.create": { fields: [
    { key: "name", required: true },
    { key: "company", required: false },
    { key: "email", required: false },
    { key: "phone", required: false },
    { key: "source", required: false },
    { key: "estimatedValue", required: false },
  ] },
  "project.create": { fields: [
    { key: "title", required: true },
    { key: "description", required: false },
    { key: "priority", required: false },
    { key: "status", required: false },
    { key: "startDate", required: false },
    { key: "dueDate", required: false },
  ] },
  "task.create": { fields: [
    { key: "title", required: true },
    { key: "description", required: false },
    { key: "priority", required: false },
    { key: "dueDate", required: false },
  ] },
  "department.create": { fields: [
    { key: "name", required: true },
    { key: "description", required: false },
  ] },
  "reminder.create": { fields: [
    { key: "title", required: true },
    { key: "note", required: false },
    { key: "dueAt", required: false },
  ] },
  "meeting.create": { fields: [
    { key: "title", required: true },
    { key: "attendee", required: false },
    { key: "scheduledAt", required: false },
    { key: "location", required: false },
    { key: "notes", required: false },
  ] },
  "note.create": { fields: [
    { key: "content", required: true },
    { key: "title", required: false },
  ] },
  "team-member.create": { fields: [
    { key: "name", required: true },
    { key: "role", required: false },
    { key: "email", required: false },
    { key: "department", required: false },
  ] },
};

const TOOL_KEYWORDS: Array<{ tool: string; match: RegExp }> = [
  { tool: "lead.create", match: /\b(lead|prospect|contact|crm|i met|met (someone|them)|referral)\b/ },
  { tool: "project.create", match: /\b(project|initiative)\b/ },
  { tool: "task.create", match: /\b(task|to-?do|to do)\b/ },
  { tool: "reminder.create", match: /\b(remind me|reminder|set a reminder|schedule a reminder)\b/ },
];

const ArgExtractionSchema = z.object({ args: z.record(z.string(), z.unknown()) });

/**
 * Pull any provided parameters out of a (possibly vague) message for a tool.
 * When `expectedFields` is supplied (during slot-filling) we bias extraction
 * so the founder's answer maps onto the field we are currently collecting.
 */
async function extractToolArgs(
  message: string,
  tool: string,
  expectedFields?: string[],
): Promise<Record<string, unknown>> {
  try {
    const fields = (CREATABLE[tool]?.fields ?? []).map((f) => f.key);
    const focus = expectedFields && expectedFields.length ? expectedFields : fields;
    const result = await callAI(
      [
        {
          role: "system",
          content: `Extract structured parameters for the tool "${tool}" from the founder's message.
Only return fields the founder actually provided. Recognized fields: ${fields.join(", ")}.
${expectedFields ? `We are currently collecting these fields, so map the founder's answer onto them: ${focus.join(", ")}.` : ""}
Respond ONLY in JSON: {"args": {field: value, ...}}. Omit or null any field not provided.`,
        },
        { role: "user", content: message },
      ],
      { jsonMode: true },
    );
    const parsed = ArgExtractionSchema.safeParse(JSON.parse(result.reply));
    if (!parsed.success) return {};
    const args: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed.data.args)) {
      if (v !== null && v !== undefined && v !== "") args[k] = v;
    }
    return args;
  } catch (err) {
    logger.error({ err }, "tool arg extraction failed");
    return {};
  }
}

/** Keyword-based intent to create an entity, with any pre-filled arguments. */
async function detectCreateIntent(
  message: string,
): Promise<{ tool: string; fields: Array<{ key: string; required: boolean }>; args: Record<string, unknown> } | null> {
  const lower = message.toLowerCase();
  const hit = TOOL_KEYWORDS.find((k) => k.match.test(lower));
  if (!hit) return null;
  const fields = CREATABLE[hit.tool]?.fields ?? [];
  const args = await extractToolArgs(message, hit.tool);
  return { tool: hit.tool, fields, args };
}

/** Field label used when asking the founder for the next missing slot. */
function fieldLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

/**
 * Continue an in-flight slot-filling action. Returns the standard orchestrator
 * response. Either completes the action or asks for the next missing field.
 */
async function resolvePendingAction(
  conversationId: string,
  pending: PendingAction,
  message: string,
): Promise<{
  conversationId: string;
  reply: string;
  modelUsed: string;
  tokensUsed: number;
  actions: Array<Record<string, unknown>>;
  workflow?: never;
}> {
  const spec = CREATABLE[pending.tool];
  const args: Record<string, unknown> = { ...pending.args };

  // Capture every field the founder happens to provide (not just the missing
  // ones) so extra details like a company or date aren't lost mid-flow.
  const missingProvided = await extractToolArgs(message, pending.tool);
  for (const [k, v] of Object.entries(missingProvided)) args[k] = v;

  const stillMissing = (spec?.fields ?? [])
    .filter((f) => f.required && (args[f.key] === undefined || args[f.key] === null || args[f.key] === ""))
    .map((f) => f.key);

  if (stillMissing.length === 0) {
    const exec = await runTool(pending.tool, args);
    await conversationRepository.setPendingAction(conversationId, null);
    const reply = exec.ok
      ? exec.message
      : `I couldn't finish that — ${exec.message}`;
    await conversationService.recordAssistantMessage(conversationId, reply, {
      senderId: exec.ok ? "executive-assistant" : "command-executor",
    });
    await conversationService.maybeSummarize(conversationId);
    return {
      conversationId,
      reply,
      modelUsed: "tool-execution",
      tokensUsed: 0,
      actions: exec.ok ? [{ tool: pending.tool, status: "success", ...args }] : [],
    };
  }

  const next = stillMissing[0];
  const remaining = stillMissing.length;
  await conversationRepository.setPendingAction(conversationId, {
    ...pending,
    args,
    missing: stillMissing,
    lastUserMessage: message,
  });
  const prompt =
    remaining === 1
      ? `Almost there — what's the ${fieldLabel(next)}?`
      : `Got it. What's the ${fieldLabel(next)}?`;
  await conversationService.recordAssistantMessage(conversationId, prompt, {
    senderId: "executive-assistant",
  });
  await conversationService.maybeSummarize(conversationId);
  return {
    conversationId,
    reply: prompt,
    modelUsed: "operational-orchestrator",
    tokensUsed: 0,
    actions: [],
  };
}

async function buildCasualReply(
  message: string,
  kind: "greeting" | "small_talk",
  context?: string,
): Promise<string> {
  const founderName = await getFounderName();
  const persona =
    kind === "greeting"
      ? `This is a casual greeting. Respond like a warm, smart friend or ChatGPT. 1-2 short sentences.${founderName ? ` Use the founder's name '${founderName}' when natural.` : ""} Be upbeat but not over-the-top. No strategy, no lists, no operational planning.`
      : "This is small talk. Respond in a warm, natural, concise way like a smart friend or ChatGPT. 1-2 sentences. No strategy, lists, or operational planning unless the founder explicitly asks.";

  try {
    const result = await callAI([
      {
        role: "system",
        content: `You are ${founderPossessive(founderName)} Executive Assistant. ${persona}${context ? `\n\nFounder context (use only if relevant):\n${context}` : ""}`,
      },
      { role: "user", content: message },
    ]);
    return result.reply;
  } catch (err) {
    logger.error({ err }, "Casual reply generation failed, using fallback.");
    return kind === "greeting"
      ? `Hey${founderName ? ` ${founderName}` : ""}! Good to see you. What would you like to work on today?`
      : "Always happy to chat. What can I help you with?";
  }
}

async function buildAnswerReply(message: string, memoryContext: string): Promise<string> {
  const founderName = await getFounderName();
  try {
    const result = await callAI([
      {
        role: "system",
        content:
          `You are ${founderPossessive(founderName)} Executive Assistant. Answer the founder's question clearly and concisely in a natural, friendly tone like ChatGPT or a smart friend. Use any provided context. Do not launch into strategy or planning unless asked.`,
      },
      {
        role: "user",
        content: `Context:\n${memoryContext}\n\nQuestion: ${message}`,
      },
    ]);
    return result.reply;
  } catch (err) {
    logger.error({ err }, "Answer reply generation failed, using fallback.");
    return "I'm here to help — could you rephrase that and I'll dig in?";
  }
}

const DRAFT_PATTERN = /draft (?:a |an )?(?:follow[- ]?up|email|message|note) (?:for|to) (.+?)[.?!]?$/i;

async function handleSalesQuery(
  conversationId: string,
  message: string,
): Promise<{
  conversationId: string;
  reply: string;
  modelUsed: string;
  tokensUsed: number;
  actions: Array<Record<string, unknown>>;
  workflow?: never;
}> {
  let reply: string;
  let actions: Array<Record<string, unknown>> = [];

  const draftMatch = message.trim().match(DRAFT_PATTERN);
  if (draftMatch) {
    const needle = draftMatch[1].trim();
    const [byName] = await db.select().from(leadsTable).where(ilike(leadsTable.name, `%${needle}%`)).limit(1);
    const [byCompany] = byName
      ? [byName]
      : await db.select().from(leadsTable).where(ilike(leadsTable.company, `%${needle}%`)).limit(1);
    const target = byName ?? byCompany;

    if (!target) {
      reply = `I couldn't find a lead matching "${needle}". Check the name on the Leads page and I'll draft it.`;
    } else {
      try {
        const draft = await salesAgent.draftFollowUp(target.id, { trigger: "chat" });
        reply = `Drafted a follow-up for ${target.name}${target.company ? ` at ${target.company}` : ""}.\n\nSubject: ${draft.subject}\n\n${draft.body}\n\nIt's waiting in the Sales Desk — mark it sent once it goes out.`;
        actions = [{ department: "Sales", tool: "sales.draft_follow_up", leadId: target.id, followUpId: draft.id, status: "success" }];
      } catch (err) {
        logger.error({ err }, "Chat-triggered follow-up draft failed");
        reply = `I couldn't draft that follow-up right now — ${err instanceof Error ? err.message : "unknown error"}.`;
      }
    }
  } else {
    reply = await salesAgent.answerQuestion(message);
    actions = [{ department: "Sales", summary: "Answered from live pipeline data", isCollaborative: false }];
  }

  await conversationService.recordAssistantMessage(conversationId, reply, { senderId: "sales-agent" });
  await conversationService.maybeSummarize(conversationId);
  await logActivity({
    entityType: "conversation",
    entityId: conversationId,
    action: "sales_query_answered",
    actorType: "agent",
    actorName: "Alex — Sales Intelligence",
    details: { message },
  });

  return { conversationId, reply, modelUsed: "sales-agent", tokensUsed: 0, actions };
}

class OrchestratorService {
  async handleFounderMessage(params: {
    message: string;
    conversationId?: string | null;
  }): Promise<{
    conversationId: string;
    reply: string;
    modelUsed: string;
    tokensUsed: number;
    actions: Array<Record<string, unknown>>;
    workflow?: never;
  }> {
    const t0 = performance.now();
    const stage = (label: string) =>
      logger.info({ stage: label, ms: Math.round(performance.now() - t0) }, "orchestrator timing");

    const conversation = await conversationService.ensureSession(params.conversationId ?? null);
    const conversationId = conversation.id;
    stage("session-resolved");

    await conversationService.recordUserMessage(conversationId, params.message);
    stage("user-message-persisted");

    // Continue an in-flight slot-filling action, if one is open.
    const pending = await conversationRepository.getPendingAction(conversationId);
    if (pending) {
      const result = await resolvePendingAction(conversationId, pending, params.message);
      stage("pending-resolved");
      return result;
    }

    const category = classifyMessage(params.message);
    logger.info({ category, message: params.message }, "message classification");
    stage("classification");

    // GREETING / SMALL TALK — warm, no Company Brain retrieval, no planner.
    if (category === "greeting" || category === "small_talk") {
      const reply = await buildCasualReply(params.message, category);
      stage("casual-reply");
      await conversationService.recordAssistantMessage(conversationId, reply, { senderId: "executive-assistant" });
      await conversationService.maybeSummarize(conversationId);
      return { conversationId, reply, modelUsed: "operational-orchestrator", tokensUsed: 0, actions: [] };
    }

    // SALES QUERY — answered by the Sales agent straight from pipeline data.
    if (category === "sales_query") {
      const result = await handleSalesQuery(conversationId, params.message);
      stage("sales-query");
      return result;
    }

    // Create-intent with missing details → start slot-filling (one field at a time).
    // Checked BEFORE generic command detection so an incomplete "create a lead"
    // doesn't get auto-completed with invented values by the command interpreter.
    const intent = await detectCreateIntent(params.message);
    if (intent) {
      const missing = intent.fields
        .filter((f) => f.required && (intent.args[f.key] === undefined || intent.args[f.key] === null || intent.args[f.key] === ""))
        .map((f) => f.key);

      if (missing.length === 0) {
        const exec = await runTool(intent.tool, intent.args);
        if (exec.ok) {
          await conversationService.recordAssistantMessage(conversationId, exec.message, { senderId: "executive-assistant" });
          await conversationService.maybeSummarize(conversationId);
          return {
            conversationId,
            reply: exec.message,
            modelUsed: "tool-execution",
            tokensUsed: 0,
            actions: [{ tool: intent.tool, status: "success", ...intent.args }],
          };
        }
        const failReply = `I couldn't complete that — ${exec.message}`;
        await conversationService.recordAssistantMessage(conversationId, failReply, { senderId: "command-executor" });
        await conversationService.maybeSummarize(conversationId);
        return { conversationId, reply: failReply, modelUsed: "tool-execution", tokensUsed: 0, actions: [] };
      }

      const pendingAction: PendingAction = {
        tool: intent.tool,
        args: intent.args,
        missing,
        lastUserMessage: params.message,
        createdAt: new Date().toISOString(),
      };
      await conversationRepository.setPendingAction(conversationId, pendingAction);
      const first = missing[0];
      const reply = `Sure — let's get that set up. What's the ${fieldLabel(first)}?`;
      await conversationService.recordAssistantMessage(conversationId, reply, { senderId: "executive-assistant" });
      await conversationService.maybeSummarize(conversationId);
      return { conversationId, reply, modelUsed: "operational-orchestrator", tokensUsed: 0, actions: [] };
    }

    // Direct tool command (e.g. "create task X by friday", "delete task 5") — execute immediately.
    const command = await detectCommand(params.message);
    stage("command-detection");
    if (command) {
      const execResult = await runTool(command.tool, command.args);
      if (execResult.ok) {
        await conversationService.recordAssistantMessage(conversationId, execResult.message, { senderId: "command-executor" });
        await conversationService.maybeSummarize(conversationId);
        await logActivity({
          entityType: "command",
          entityId: conversationId,
          action: "executed",
          actorType: "system",
          actorName: "Command Executor",
          details: { tool: command.tool, args: command.args, result: execResult.message },
        });
        return {
          conversationId,
          reply: execResult.message,
          modelUsed: "tool-execution",
          tokensUsed: 0,
          actions: [{ tool: command.tool, ...command.args, status: "success" }],
        };
      }
    }

    // QUESTION — relevant memories + founder profile, no heavy planner.
    if (category === "question") {
      const memoryContext = await memoryService.buildContextBlock({
        query: params.message,
        entityLinks: [{ entityType: "conversation", entityId: conversationId }],
        limit: 6,
      });
      stage("memory");
      const profile = await memoryService.getFounderProfile();
      const context = `${profile ? `Founder profile:\n${profile}\n\n` : ""}${memoryContext}`;
      const reply = await buildAnswerReply(params.message, context);
      stage("answer-reply");
      await conversationService.recordAssistantMessage(conversationId, reply, { senderId: "executive-assistant" });
      await conversationService.maybeSummarize(conversationId);
      return { conversationId, reply, modelUsed: "operational-orchestrator", tokensUsed: 0, actions: [] };
    }

    // PLANNING / everything else — full orchestration with retrieved context.
    const briefing = await operationalIntelligenceService.buildFounderBriefing();
    stage("briefing");
    const memoryContext = await memoryService.buildContextBlock({
      query: params.message,
      entityLinks: [{ entityType: "conversation", entityId: conversationId }],
      limit: 6,
    });
    stage("memory");
    const profile = await memoryService.getFounderProfile();
    const context = `${profile ? `Founder profile:\n${profile}\n\n` : ""}${memoryContext}`;

    const intentAnalysis = await analyzeIntent(params.message, `${briefing.summary}\n${context}`);
    stage("intent");

    let reply = "";
    let actions: Array<Record<string, unknown>> = [];

    if (intentAnalysis.departments.length > 1 || intentAnalysis.primaryIntent === "planning") {
      const warRoomResult = await warRoomService.initiateCollaboration({
        objective: params.message,
        departments: intentAnalysis.departments,
        priority: intentAnalysis.priority,
      });

      reply = await buildFounderResponse({
        message: params.message,
        intent: intentAnalysis,
        agentOutputs: warRoomResult.agentContributions,
        briefingSummary: briefing.summary,
        memoryContext: `${context}\n\nStrategic Synthesis: ${warRoomResult.synthesis}`,
      });

      actions = warRoomResult.agentContributions.map((o) => ({
        department: o.department,
        summary: o.summary,
        nextSteps: o.nextSteps,
        worklog: o.worklog,
        isCollaborative: true,
      }));
    } else {
      const delegations = buildDelegations(params.message, intentAnalysis, context);
      const agentOutputs: Awaited<ReturnType<typeof agentRuntime.executeDelegation>>[] = [];
      for (const delegation of delegations) {
        const output = await agentRuntime.executeDelegation(delegation);
        agentOutputs.push(output);
      }
      reply = await buildFounderResponse({
        message: params.message,
        intent: intentAnalysis,
        agentOutputs,
        briefingSummary: briefing.summary,
        memoryContext: context,
      });
      actions = agentOutputs.map((output) => ({
        department: output.department,
        summary: output.summary,
        nextSteps: output.nextSteps,
        worklog: output.worklog,
      }));
    }

    if (intentAnalysis.unavailableDepartments.length > 0) {
      const list = intentAnalysis.unavailableDepartments;
      const names = list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0];
      const verb = intentAnalysis.unavailableDepartments.length === 1 ? "is" : "are";
      reply = `${reply.trim()}\n\n(${names} ${verb} coming soon — Sales and I are the only live departments right now, so I handled this myself.)`;
    }

    await conversationService.recordAssistantMessage(conversationId, reply, { senderId: "executive-assistant" });
    await conversationService.maybeSummarize(conversationId);

    await memoryService.extractConversationMemories(conversationId);
    await memoryService.writeActionMemories({
      summary: `Founder request orchestrated: ${params.message}. ${reply}`,
      relatedEntities: intentAnalysis.relatedEntities.map((entity) => ({
        entityType: entity.entityType,
        entityId: entity.entityId ?? conversationId,
      })),
    });

    await logActivity({
      entityType: "conversation",
      entityId: conversationId,
      action: "orchestrated",
      actorType: "agent",
      actorName: "Executive Assistant",
      details: {
        intent: intentAnalysis.primaryIntent,
        priority: intentAnalysis.priority,
        departments: intentAnalysis.departments,
      },
    });

    publishOperationalEvent("orchestrator.completed", {
      conversationId,
      intent: intentAnalysis.primaryIntent,
      departments: intentAnalysis.departments,
      priority: intentAnalysis.priority,
    });

    if (intentAnalysis.priority === "urgent") {
      await createOperationalNotification({
        type: "alert",
        title: "Urgent founder request routed",
        body: `The Executive Assistant escalated an urgent request across ${intentAnalysis.departments.join(", ")}.`,
        priority: "urgent",
        metadata: { conversationId, intent: intentAnalysis.primaryIntent },
      });
    }

    return { conversationId, reply, modelUsed: "operational-orchestrator", tokensUsed: 0, actions };
  }
}

export const orchestratorService = new OrchestratorService();
