import { randomUUID } from "node:crypto";
import { publishOperationalEvent } from "./event-bus";

/**
 * Canonical event envelope shared by ALL future FounderOS systems
 * (Planner, Observer, Reflection, Learning, Scheduler, Dashboard, Voice).
 *
 * Every event carries a stable `correlationId` so a single founder action
 * (and every downstream effect) can be traced end-to-end, plus an optional
 * `causationId` linking a derived event back to the event that caused it.
 */

export type CorrelationContext = {
  correlationId: string;
  causationId?: string;
};

export type EventEnvelope = {
  id: string;
  correlationId: string;
  causationId?: string;
  type: string;
  source: string;
  timestamp: string;
  payload: Record<string, unknown>;
};

export function newCorrelationId(): string {
  return randomUUID();
}

export function newEventId(): string {
  return randomUUID();
}

export function createEnvelope(
  type: string,
  source: string,
  payload: Record<string, unknown>,
  ctx?: CorrelationContext,
): EventEnvelope {
  const correlationId = ctx?.correlationId ?? newCorrelationId();
  return {
    id: newEventId(),
    correlationId,
    causationId: ctx?.causationId,
    type,
    source,
    timestamp: new Date().toISOString(),
    payload,
  };
}

/**
 * Publish an envelope through the existing Event Bus. Correlation metadata is
 * merged into the payload so current subscribers (which read `payload`) keep
 * working unchanged, while future systems can rely on the canonical fields.
 */
export function publishEnvelope(envelope: EventEnvelope): void {
  publishOperationalEvent(envelope.type, {
    ...envelope.payload,
    eventId: envelope.id,
    correlationId: envelope.correlationId,
    ...(envelope.causationId ? { causationId: envelope.causationId } : {}),
  });
}

/**
 * Run an async unit of work inside a correlation context. If a parent context
 * is supplied, the new work shares the parent's `correlationId` and records it
 * as `causationId` — establishing the chain across systems.
 */
export function runWithCorrelation<T>(
  fn: (ctx: CorrelationContext) => Promise<T>,
  parent?: CorrelationContext,
): Promise<T> {
  const ctx: CorrelationContext = {
    correlationId: parent?.correlationId ?? newCorrelationId(),
    causationId: parent?.correlationId,
  };
  return fn(ctx);
}
