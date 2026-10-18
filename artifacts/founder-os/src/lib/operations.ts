export type ActivityLike = {
  entityType?: string | null;
  action?: string | null;
  actorType?: string | null;
  actorName?: string | null;
  details?: Record<string, unknown> | null;
};

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function getActivityTone(activity: ActivityLike): "critical" | "attention" | "active" | "calm" {
  const action = slugify(activity.action ?? "");
  const details = JSON.stringify(activity.details ?? {}).toLowerCase();

  if (action.includes("failed") || action.includes("risk") || details.includes("urgent")) {
    return "critical";
  }
  if (action.includes("updated") || action.includes("triggered") || action.includes("qualified")) {
    return "attention";
  }
  if (action.includes("created") || action.includes("message") || action.includes("sent")) {
    return "active";
  }

  return "calm";
}

export function summarizeActivity(activity: ActivityLike): string {
  const actor = activity.actorName ?? "FounderOS";
  const entity = activity.entityType ? activity.entityType.replace(/_/g, " ") : "system";
  const action = activity.action ? activity.action.replace(/_/g, " ") : "updated";

  if (entity === "lead") return `${actor} pushed pipeline momentum with a ${action}.`;
  if (entity === "task") return `${actor} shifted execution flow with a task ${action}.`;
  if (entity === "workflow") return `${actor} changed automation posture with a workflow ${action}.`;
  if (entity === "conversation") return `${actor} added a new executive exchange.`;
  if (entity === "revenue") return `${actor} updated financial visibility.`;
  if (entity === "project") return `${actor} adjusted project execution state.`;

  return `${actor} logged a ${action} event on ${entity}.`;
}

export function getToneClasses(tone: "critical" | "attention" | "active" | "calm"): string {
  switch (tone) {
    case "critical":
      return "border-rose-500/50 bg-rose-100 text-rose-950";
    case "attention":
      return "border-amber-500/50 bg-amber-100 text-amber-950";
    case "active":
      return "border-emerald-500/50 bg-emerald-100 text-emerald-950";
    default:
      return "border-slate-300 bg-white/80 text-slate-800";
  }
}

export function getHealthLabel(load: number): string {
  if (load >= 8) return "Peak load";
  if (load >= 5) return "High focus";
  if (load >= 3) return "Steady";
  return "Standby";
}
