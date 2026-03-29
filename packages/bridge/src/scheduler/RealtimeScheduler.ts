import type { EntityUpdate, EntityValue } from "@artnet-bridge/protocol";
import { isDeepEqual } from "@artnet-bridge/protocol";

export class RealtimeScheduler {
  private readonly dirtySet = new Set<string>();
  private readonly valueMap = new Map<string, EntityValue>();
  private readonly onTick: (updates: EntityUpdate[]) => Promise<void>;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(rateHz: number, onTick: (updates: EntityUpdate[]) => Promise<void>) {
    this.intervalMs = Math.round(1000 / rateHz);
    this.onTick = onTick;
  }

  update(entityId: string, value: EntityValue): void {
    // Skip if value is identical to what we already have
    const existing = this.valueMap.get(entityId);
    if (existing !== undefined && isDeepEqual(existing, value)) {
      return;
    }
    this.valueMap.set(entityId, value);
    this.dirtySet.add(entityId);
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

  /** Exposed for testing. Collects dirty entities and dispatches them as a batch. */
  async tick(): Promise<void> {
    if (this.dirtySet.size === 0) return;

    const updates: EntityUpdate[] = [];
    for (const entityId of this.dirtySet) {
      const value = this.valueMap.get(entityId);
      if (value) updates.push({ entityId, value });
    }
    this.dirtySet.clear();

    await this.onTick(updates);
  }
}
