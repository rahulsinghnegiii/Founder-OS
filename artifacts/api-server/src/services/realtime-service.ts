import type { Response } from "express";
import { eventBus, type OperationalEventEnvelope } from "../lib/event-bus";

type Client = {
  id: string;
  res: Response;
};

class RealtimeService {
  private readonly clients = new Map<string, Client>();
  private initialized = false;

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    eventBus.on("__all__", (payload) => {
      const envelope = payload as OperationalEventEnvelope;
      this.broadcast(envelope);
    });
  }

  registerClient(res: Response): string {
    const id = crypto.randomUUID();
    this.clients.set(id, { id, res });
    return id;
  }

  removeClient(id: string): void {
    this.clients.delete(id);
  }

  broadcast(event: OperationalEventEnvelope): void {
    const payload = `event: ${event.name}\ndata: ${JSON.stringify(event)}\n\n`;

    for (const client of this.clients.values()) {
      client.res.write(payload);
    }
  }
}

export const realtimeService = new RealtimeService();
