import * as assert from "node:assert/strict";
import type { EntityValue } from "@artnet-bridge/protocol";
import { LimitedScheduler } from "../../src/scheduler/LimitedScheduler.js";

function brightness(value: number): EntityValue {
  return { type: "brightness", value };
}

describe("LimitedScheduler", () => {
  it("dispatches entity with latest value on tick", async () => {
    const dispatched: Array<{ entityId: string; value: EntityValue }> = [];
    const scheduler = new LimitedScheduler(10, async (entityId, value) => {
      dispatched.push({ entityId, value });
    });

    scheduler.update("light1", brightness(1000));
    await scheduler.tick();

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].entityId, "light1");
    assert.deepEqual(dispatched[0].value, brightness(1000));
  });

  it("dispatches entities in FIFO insertion order (round-robin)", async () => {
    const dispatched: string[] = [];
    const scheduler = new LimitedScheduler(10, async (entityId) => {
      dispatched.push(entityId);
    });

    scheduler.update("light1", brightness(100));
    scheduler.update("light2", brightness(200));
    scheduler.update("light3", brightness(300));

    await scheduler.tick();
    await scheduler.tick();
    await scheduler.tick();

    assert.deepEqual(dispatched, ["light1", "light2", "light3"]);
  });

  it("keeps original position when entity is updated again while waiting", async () => {
    const dispatched: Array<{ entityId: string; value: EntityValue }> = [];
    const scheduler = new LimitedScheduler(10, async (entityId, value) => {
      dispatched.push({ entityId, value });
    });

    scheduler.update("light1", brightness(100));
    scheduler.update("light2", brightness(200));
    // Update light1 again — should keep its position (first), but use latest value
    scheduler.update("light1", brightness(999));

    await scheduler.tick();

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].entityId, "light1");
    assert.deepEqual(dispatched[0].value, brightness(999));
  });

  it("skips tick if previous dispatch is still pending", async () => {
    const dispatched: string[] = [];
    let resolveDispatch: (() => void) | undefined;
    let shouldBlock = true;

    const scheduler = new LimitedScheduler(10, async (entityId) => {
      dispatched.push(entityId);
      if (shouldBlock) {
        // Simulate slow dispatch — block until explicitly resolved
        await new Promise<void>((resolve) => {
          resolveDispatch = resolve;
        });
      }
    });

    scheduler.update("light1", brightness(100));
    scheduler.update("light2", brightness(200));

    // Start first dispatch (will block on the gate promise).
    // Do NOT await — we want tick to be in-flight.
    const firstTick = scheduler.tick();

    // Yield so that tick() enters onDispatch and suspends at the gate
    await new Promise((r) => setTimeout(r, 10));

    // dispatching flag should still be true — second tick is skipped
    await scheduler.tick();

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0], "light1");

    // Resolve the first dispatch and stop blocking future dispatches
    shouldBlock = false;
    resolveDispatch!();
    await firstTick;

    // Now the second tick should work
    await scheduler.tick();
    assert.equal(dispatched.length, 2);
    assert.equal(dispatched[1], "light2");
  });

  it("does not re-queue entity after dispatch until next value change", async () => {
    const dispatched: string[] = [];
    const scheduler = new LimitedScheduler(10, async (entityId) => {
      dispatched.push(entityId);
    });

    scheduler.update("light1", brightness(100));
    await scheduler.tick();
    // Second tick without new update — should be no-op
    await scheduler.tick();

    assert.equal(dispatched.length, 1);
  });

  it("is a no-op when queue is empty", async () => {
    const dispatched: string[] = [];
    const scheduler = new LimitedScheduler(10, async (entityId) => {
      dispatched.push(entityId);
    });

    await scheduler.tick();

    assert.equal(dispatched.length, 0);
  });

  it("start and stop control the interval timer", () => {
    const scheduler = new LimitedScheduler(1000, async () => {
      // no-op
    });

    scheduler.start();
    // Calling start again should be harmless
    scheduler.start();
    scheduler.stop();
    // Calling stop again should be harmless
    scheduler.stop();
  });
});
