import EventEmitter from "events";

class TypedEventBus extends EventEmitter {
  emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }
}

export const eventBus = new TypedEventBus();
eventBus.setMaxListeners(50);
