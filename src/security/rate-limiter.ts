export class SlidingWindowRateLimiter {
  private actions: number[] = [];

  constructor(
    private readonly maxActions: number,
    private readonly windowMs: number = 3_600_000,
  ) {}

  record(): boolean {
    this.prune();
    if (this.actions.length >= this.maxActions) return false;
    this.actions.push(Date.now());
    return true;
  }

  count(): number {
    this.prune();
    return this.actions.length;
  }

  isLimited(): boolean {
    this.prune();
    return this.actions.length >= this.maxActions;
  }

  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    this.actions = this.actions.filter(t => t > cutoff);
  }
}

export class ScopedRateLimiter {
  private global: SlidingWindowRateLimiter;
  private perAgent = new Map<string, SlidingWindowRateLimiter>();
  private perToolClass = new Map<string, SlidingWindowRateLimiter>();

  constructor(private config: {
    global: number;
    perAgent?: number;
    perToolClass?: Record<string, number>;
  }) {
    this.global = new SlidingWindowRateLimiter(config.global);
  }

  record(toolClass?: string, agentId?: string): boolean {
    if (!this.global.record()) return false;

    if (agentId && this.config.perAgent) {
      if (!this.perAgent.has(agentId)) {
        this.perAgent.set(agentId, new SlidingWindowRateLimiter(this.config.perAgent));
      }
      if (!this.perAgent.get(agentId)!.record()) return false;
    }

    if (toolClass && this.config.perToolClass?.[toolClass]) {
      if (!this.perToolClass.has(toolClass)) {
        this.perToolClass.set(toolClass, new SlidingWindowRateLimiter(this.config.perToolClass[toolClass]));
      }
      if (!this.perToolClass.get(toolClass)!.record()) return false;
    }

    return true;
  }

  isLimited(toolClass?: string, agentId?: string): boolean {
    if (this.global.isLimited()) return true;
    if (agentId && this.perAgent.get(agentId)?.isLimited()) return true;
    if (toolClass && this.perToolClass.get(toolClass)?.isLimited()) return true;
    return false;
  }
}
