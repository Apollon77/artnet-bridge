import type { EntityValue } from "@artnet-bridge/protocol";

export class LimitedScheduler {
  private readonly dirtySet = new Set<string>();
  private readonly valueMap = new Map<string, EntityValue>();
  private readonly lastSentMap = new Map<string, string>(); // entityId → JSON of last sent value
  private readonly onDispatch: (entityId: string, value: EntityValue) => Promise<void>;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private dispatching = false;

  constructor(
    ratePerSec: number,
    onDispatch: (entityId: string, value: EntityValue) => Promise<void>,
  ) {
    this.intervalMs = Math.round(1000 / ratePerSec);
    this.onDispatch = onDispatch;
  }

  update(entityId: string, value: EntityValue): void {
    // Skip if value hasn't changed since last successful send
    const serialized = JSON.stringify(value);
    if (this.lastSentMap.get(entityId) === serialized) {
      return;
    }
    this.valueMap.set(entityId, value);
    if (!this.dirtySet.has(entityId)) {
      this.dirtySet.add(entityId); // appended at end (insertion order)
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => console.error("Scheduler tick error:", err));
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Exposed for testing. Dispatches the most stale entity. */
  async tick(): Promise<void> {
    // Skip if previous dispatch still in progress
    if (this.dispatching) return;
    if (this.dirtySet.size === 0) return;

    // Take the first (most stale) entity
    const entityId = this.dirtySet.values().next().value;
    if (entityId === undefined) return;
    this.dirtySet.delete(entityId);

    const value = this.valueMap.get(entityId);
    if (!value) return;

    this.dispatching = true;
    try {
      await this.onDispatch(entityId, value);
      this.lastSentMap.set(entityId, JSON.stringify(value));
    } finally {
      this.dispatching = false;
    }
  }
}
