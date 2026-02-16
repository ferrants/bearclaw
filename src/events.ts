export interface EventMap {
  'agent:started': { agentId: string; conversationId: string };
  'agent:stopped': { agentId: string; reason: string };
  'tool:executed': { tool: string; duration: number; isError: boolean };
  'policy:decision': { tool: string; ruleId?: string; action: string };
  'provider:call': { provider: string; model: string; tokens: number; latency: number };
  'provider:error': { provider: string; status: number; retries: number };
  'conversation:created': { id: string; channel: string };
  'conversation:completed': { id: string; pending: number };
  'conversation:timeout': { id: string; elapsed: number };
}

type EventHandler<T> = (data: T) => void;

export class EventBus {
  private handlers = new Map<string, EventHandler<unknown>[]>();

  on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler as EventHandler<unknown>);
    this.handlers.set(event, list);
  }

  off<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void {
    const list = this.handlers.get(event);
    if (!list) return;
    const idx = list.indexOf(handler as EventHandler<unknown>);
    if (idx !== -1) list.splice(idx, 1);
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const list = this.handlers.get(event);
    if (!list) return;
    for (const handler of list) {
      try {
        handler(data);
      } catch {
        // swallow handler errors to prevent cascading failures
      }
    }
  }
}
