import EventEmitter from "events";

class TypedEventBus extends EventEmitter {
  emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }
}

export const eventBus = new TypedEventBus();
eventBus.setMaxListeners(50);

export type OperationalEventEnvelope = {
  at: string;
  name: string;
  payload: Record<string, unknown>;
};

export function publishOperationalEvent(name: string, payload: Record<string, unknown> = {}): void {
  const envelope: OperationalEventEnvelope = {
    at: new Date().toISOString(),
    name,
    payload,
  };

  eventBus.emit(name, payload);
  eventBus.emit("__all__", envelope);
}

/** Ergonomic subscription helper for domain/tool event handlers. */
export function subscribe(event: string, handler: (payload: Record<string, unknown>) => void): void {
  eventBus.on(event, handler);
}
