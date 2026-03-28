import * as assert from "node:assert/strict";
import type { EntityUpdate, EntityValue } from "@artnet-bridge/protocol";
import { RealtimeScheduler } from "../../src/scheduler/RealtimeScheduler.js";

function rgb(r: number, g: number, b: number): EntityValue {
  return { type: "rgb", r, g, b };
}

describe("RealtimeScheduler", () => {
  it("collects dirty entity into batch on tick", async () => {
    const batches: EntityUpdate[][] = [];
    const scheduler = new RealtimeScheduler(10, async (updates) => {
      batches.push(updates);
    });

    scheduler.update("light1", rgb(100, 200, 50));
    await scheduler.tick();

    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 1);
    assert.equal(batches[0][0].entityId, "light1");
    assert.deepEqual(batches[0][0].value, rgb(100, 200, 50));
  });

  it("sends only the latest value when updated twice before tick", async () => {
    const batches: EntityUpdate[][] = [];
    const scheduler = new RealtimeScheduler(10, async (updates) => {
      batches.push(updates);
    });

    scheduler.update("light1", rgb(100, 200, 50));
    scheduler.update("light1", rgb(255, 0, 0));
    await scheduler.tick();

    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 1);
    assert.deepEqual(batches[0][0].value, rgb(255, 0, 0));
  });

  it("clears dirty set after tick", async () => {
    const batches: EntityUpdate[][] = [];
    const scheduler = new RealtimeScheduler(10, async (updates) => {
      batches.push(updates);
    });

    scheduler.update("light1", rgb(100, 200, 50));
    await scheduler.tick();
    await scheduler.tick();

    assert.equal(batches.length, 1);
  });

  it("is a no-op when no updates have occurred", async () => {
    const batches: EntityUpdate[][] = [];
    const scheduler = new RealtimeScheduler(10, async (updates) => {
      batches.push(updates);
    });

    await scheduler.tick();

    assert.equal(batches.length, 0);
  });

  it("includes multiple entities in one batch", async () => {
    const batches: EntityUpdate[][] = [];
    const scheduler = new RealtimeScheduler(10, async (updates) => {
      batches.push(updates);
    });

    scheduler.update("light1", rgb(100, 0, 0));
    scheduler.update("light2", rgb(0, 200, 0));
    scheduler.update("light3", rgb(0, 0, 50));
    await scheduler.tick();

    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 3);
    const ids = batches[0].map((u) => u.entityId);
    assert.ok(ids.includes("light1"));
    assert.ok(ids.includes("light2"));
    assert.ok(ids.includes("light3"));
  });

  it("start and stop control the interval timer", async () => {
    const batches: EntityUpdate[][] = [];
    const scheduler = new RealtimeScheduler(1000, async (updates) => {
      batches.push(updates);
    });

    scheduler.start();
    // Calling start again should be harmless
    scheduler.start();
    scheduler.stop();
    // Calling stop again should be harmless
    scheduler.stop();
  });
});
