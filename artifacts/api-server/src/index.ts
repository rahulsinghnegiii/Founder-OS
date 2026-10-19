import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

function loadEnv() {
  const dir = import.meta.dirname ?? process.cwd();
  const searchPaths = [
    process.cwd(),
    dir,
    resolve(dir, ".."),
    resolve(dir, "../.."),
    resolve(dir, "../../.."),
  ];

  for (const dir of searchPaths) {
    const envFile = resolve(dir, ".env");
    if (!existsSync(envFile)) continue;
    const content = readFileSync(envFile, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eqIndex = trimmed.indexOf("=");
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, "");
      if (key && value && !process.env[key]) process.env[key] = value;
    }
    console.log(`[env] Loaded ${envFile}`);
    return;
  }
  console.warn("[env] No .env file found");
}

loadEnv();

// Node abandons each address of a host after 250 ms by default ("happy
// eyeballs"). On slow or high-latency links every attempt dies before the TCP
// handshake finishes and AI calls fail with UND_ERR_CONNECT_TIMEOUT even
// though curl works. Give each address a realistic window.
const connectAttemptMs = Number(process.env.NET_CONNECT_ATTEMPT_MS) || 2500;
setDefaultAutoSelectFamilyAttemptTimeout(connectAttemptMs);

const { default: app } = await import("./app");
const { logger } = await import("./lib/logger");

// Activate the Event Bus → Workflow Engine wiring so domain events
// (task.created, department.created, lead.created, ...) can trigger workflows.
const { workflowEngine } = await import("./services/workflow-engine");
workflowEngine.initialize();

// Activate the Company Brain event sync so memory stays current automatically.
const { registerBrainEventSync } = await import("./services/brain-event-sync");
registerBrainEventSync();

// Activate the Sales agent: stale-deal scans, proposal follow-through, lead scoring.
const { salesAgent } = await import("./services/sales-agent");
salesAgent.start();

// Optional Gmail sync: keeps last-contact dates current from email headers.
const { gmailSync } = await import("./services/gmail-sync");
gmailSync.start();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});