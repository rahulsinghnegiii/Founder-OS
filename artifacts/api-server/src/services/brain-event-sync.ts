import { subscribe } from "../lib/event-bus";
import { companyBrain } from "./company-brain";
import { logger } from "../lib/logger";

type Payload = Record<string, unknown>;

function safe(handler: (p: Payload) => Promise<void>): (p: Payload) => void {
  return (p: Payload) => {
    handler(p).catch((err) => logger.error({ err, event: "brain-sync" }, "Brain event sync handler failed"));
  };
}

/**
 * Subscribe the Company Brain to existing domain events so memory stays current
 * without manual updates. Registered once at server boot.
 */
export function registerBrainEventSync(): void {
  subscribe(
    "task.created",
    safe(async (p) => {
      const id = p.id as string | undefined;
      if (!id) return;
      await companyBrain.remember({
        entityType: "task",
        entityId: id,
        category: "Task",
        key: `task:${id}`,
        value: String(p.result ?? "Task created"),
        source: "event:task.created",
      });
    }),
  );

  subscribe(
    "task.deleted",
    safe(async (p) => {
      await companyBrain.forgetByEntity("task", p.id as string | undefined);
    }),
  );

  subscribe(
    "department.created",
    safe(async (p) => {
      const id = p.id as string | undefined;
      if (!id) return;
      await companyBrain.remember({
        entityType: "department",
        entityId: id,
        category: "Department",
        key: `dept:${id}`,
        value: String(p.result ?? "Department created"),
        source: "event:department.created",
      });
    }),
  );

  subscribe(
    "department.renamed",
    safe(async (p) => {
      const id = p.id as string | undefined;
      await companyBrain.updateByEntity("department", id ?? null, {
        value: String(p.result ?? "Department renamed"),
        key: id ? `dept:${id}` : "dept",
      });
    }),
  );

  subscribe(
    "workflow.execution.completed",
    safe(async (p) => {
      const wfId = (p.workflowId as string) ?? (p.id as string) ?? (p.payload as Payload | undefined)?.workflowId;
      if (!wfId) return;
      await companyBrain.remember({
        entityType: "workflow",
        entityId: wfId,
        category: "Workflow",
        key: `wf:${wfId}`,
        value: `Workflow executed (${String(p.triggerEvent ?? "event")})`,
        source: "event:workflow.execution.completed",
      });
    }),
  );

  subscribe(
    "tool.execution.failed",
    safe(async (p) => {
      await companyBrain.remember({
        entityType: "learning",
        category: "Learning",
        key: `failure:${String(p.tool ?? "tool")}:${Date.now()}`,
        value: `Tool ${String(p.tool ?? "unknown")} failed: ${String(p.message ?? "no details")}`,
        source: "event:tool.execution.failed",
        confidence: 0.9,
      });
    }),
  );

  subscribe(
    "report.generated",
    safe(async (p) => {
      const id = p.id as string | undefined;
      await companyBrain.remember({
        entityType: "report",
        entityId: id,
        category: "Report",
        key: `report:${id ?? Date.now()}`,
        value: String(p.result ?? p.title ?? "Report generated"),
        source: "event:report.generated",
      });
    }),
  );
}
