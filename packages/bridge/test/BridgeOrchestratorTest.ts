import * as assert from "node:assert/strict";
import { ArtNetReceiver, ArtNetSender } from "@artnet-bridge/artnet";
import type {
  ProtocolAdapter,
  ProtocolBridge,
  Entity,
  EntityUpdate,
  EntityValue,
  DiscoveredBridge,
  PairingResult,
  AdapterStatus,
} from "@artnet-bridge/protocol";
import type { AppConfig, BridgeConfig } from "../src/config/ConfigSchema.js";
import { BridgeOrchestrator } from "../src/BridgeOrchestrator.js";

// --- Test helpers ---

function makeEntity(id: string, controlMode: "realtime" | "limited", category: string): Entity {
  return {
    id,
    metadata: { name: id, type: "light" },
    controlMode,
    category,
    channelLayout: { type: "rgb" },
  };
}

function makeBrightnessEntity(
  id: string,
  controlMode: "realtime" | "limited",
  category: string,
): Entity {
  return {
    id,
    metadata: { name: id, type: "group" },
    controlMode,
    category,
    channelLayout: { type: "brightness" },
  };
}

const mockBridgeId = "bridge-1";

function makeMockProtocolBridge(entities: Entity[], id: string = mockBridgeId): ProtocolBridge {
  return {
    id,
    metadata: { name: "Mock Bridge", host: "127.0.0.1" },
    entities,
    rateLimits: {
      "realtime-light": {
        maxPerSecond: 10,
        defaultPerSecond: 6,
        description: "Realtime light updates",
      },
      light: {
        maxPerSecond: 10,
        defaultPerSecond: 10,
        description: "Limited light updates",
      },
      group: {
        maxPerSecond: 1,
        defaultPerSecond: 1,
        description: "Group updates",
      },
    },
  };
}

class MockAdapter implements ProtocolAdapter {
  readonly id: string;
  readonly name: string;
  readonly type = "mock";

  connected = false;
  realtimeUpdates: Array<{ bridgeId: string; updates: EntityUpdate[] }> = [];
  limitedUpdates: Array<{
    bridgeId: string;
    entityId: string;
    value: EntityValue;
  }> = [];

  private readonly bridges: ProtocolBridge[];

  constructor(bridges: ProtocolBridge[], id = "mock-adapter") {
    this.id = id;
    this.name = `Mock Adapter ${id}`;
    this.bridges = bridges;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  async discover(): Promise<DiscoveredBridge[]> {
    return [];
  }
  async pair(_target: DiscoveredBridge): Promise<PairingResult> {
    return { success: false, error: "mock" };
  }
  async getBridges(): Promise<ProtocolBridge[]> {
    return this.bridges;
  }
  async handleRealtimeUpdate(bridgeId: string, updates: EntityUpdate[]): Promise<void> {
    this.realtimeUpdates.push({ bridgeId, updates });
  }
  async handleLimitedUpdate(bridgeId: string, entityId: string, value: EntityValue): Promise<void> {
    this.limitedUpdates.push({ bridgeId, entityId, value });
  }
  getStatus(): AdapterStatus {
    const bridges: Record<
      string,
      {
        connected: boolean;
        streaming?: boolean;
        lastUpdate?: number;
        stats: Record<string, number>;
      }
    > = {};
    for (const b of this.bridges) {
      bridges[b.id] = {
        connected: this.connected,
        streaming: true,
        stats: {},
      };
    }
    return { connected: this.connected, bridges };
  }
}

function makeConfig(bridges: BridgeConfig[]): AppConfig {
  return {
    version: 1,
    artnet: { bindAddress: "127.0.0.1", port: 0 },
    web: { port: 8080, enabled: false },
    bridges,
  };
}

function makeBridgeConfig(
  id: string,
  universe: number,
  mappings: Array<{
    targetId: string;
    targetType: string;
    dmxStart: number;
    channelMode: "8bit" | "8bit-dimmable" | "16bit" | "scene-selector" | "brightness";
  }>,
): BridgeConfig {
  return {
    id,
    protocol: "mock",
    connection: {},
    universe,
    channelMappings: mappings,
  };
}

// Get a random high port for ArtNet testing
let nextPort = 30000 + Math.floor(Math.random() * 10000);
function getTestPort(): number {
  return nextPort++;
}

// --- Tests ---

describe("BridgeOrchestrator", () => {
  let orchestrator: BridgeOrchestrator | undefined;

  afterEach(async () => {
    if (orchestrator) {
      await orchestrator.stop();
      orchestrator = undefined;
    }
  });

  it("connects and disconnects adapters on start/stop", async () => {
    const realtimeEntity = makeEntity("light-1", "realtime", "realtime-light");
    const mockBridge = makeMockProtocolBridge([realtimeEntity]);
    const mockAdapter = new MockAdapter([mockBridge]);

    const port = getTestPort();
    const config = makeConfig([
      makeBridgeConfig("bridge-1", 0, [
        { targetId: "light-1", targetType: "light", dmxStart: 1, channelMode: "8bit" },
      ]),
    ]);
    config.artnet.port = port;

    const factories = new Map<string, (bc: BridgeConfig) => ProtocolAdapter>();
    factories.set("mock", () => mockAdapter);

    const artnet = new ArtNetReceiver({ bindAddress: "127.0.0.1", port });
    orchestrator = new BridgeOrchestrator(config, artnet, factories);

    assert.equal(mockAdapter.connected, false);
    await orchestrator.start();
    assert.equal(mockAdapter.connected, true);

    await orchestrator.stop();
    assert.equal(mockAdapter.connected, false);
    orchestrator = undefined;
  });

  it("routes DMX frame to correct bridge by universe", async () => {
    const entity = makeEntity("light-1", "realtime", "realtime-light");
    const mockBridge = makeMockProtocolBridge([entity], "bridge-1");
    const mockAdapter = new MockAdapter([mockBridge]);

    const port = getTestPort();
    const config = makeConfig([
      makeBridgeConfig("bridge-1", 0, [
        { targetId: "light-1", targetType: "light", dmxStart: 1, channelMode: "8bit" },
      ]),
    ]);
    config.artnet.port = port;

    const factories = new Map<string, (bc: BridgeConfig) => ProtocolAdapter>();
    factories.set("mock", () => mockAdapter);

    const artnet = new ArtNetReceiver({ bindAddress: "127.0.0.1", port });
    orchestrator = new BridgeOrchestrator(config, artnet, factories);
    await orchestrator.start();

    // Send a DMX frame via ArtNetSender
    const sender = new ArtNetSender({ targetAddress: "127.0.0.1", port });
    await sender.waitReady();
    const dmxData = new Uint8Array(512);
    dmxData[0] = 255; // R
    dmxData[1] = 128; // G
    dmxData[2] = 64; // B
    sender.sendDmx(0, dmxData);

    // Wait for the frame to arrive
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    sender.close();

    const status = orchestrator.getStatus();
    assert.ok(status.artnet.frameCount > 0, "Should have received at least one frame");
    assert.ok((status.artnet.frameCounts[0] ?? 0) > 0, "Universe 0 should have received frames");
  });

  it("routes entities to realtime vs limited schedulers", async () => {
    const realtimeEntity = makeEntity("light-rt", "realtime", "realtime-light");
    const limitedEntity = makeEntity("light-lim", "limited", "light");
    const mockBridge = makeMockProtocolBridge([realtimeEntity, limitedEntity], "bridge-1");
    const mockAdapter = new MockAdapter([mockBridge]);

    const port = getTestPort();
    const config = makeConfig([
      makeBridgeConfig("bridge-1", 0, [
        {
          targetId: "light-rt",
          targetType: "light",
          dmxStart: 1,
          channelMode: "8bit",
        },
        {
          targetId: "light-lim",
          targetType: "light",
          dmxStart: 4,
          channelMode: "8bit",
        },
      ]),
    ]);
    config.artnet.port = port;

    const factories = new Map<string, (bc: BridgeConfig) => ProtocolAdapter>();
    factories.set("mock", () => mockAdapter);

    const artnet = new ArtNetReceiver({ bindAddress: "127.0.0.1", port });
    orchestrator = new BridgeOrchestrator(config, artnet, factories);
    await orchestrator.start();

    // Send DMX data that covers both entities
    const sender = new ArtNetSender({ targetAddress: "127.0.0.1", port });
    await sender.waitReady();
    const dmxData = new Uint8Array(512);
    // light-rt: channels 1-3
    dmxData[0] = 100;
    dmxData[1] = 200;
    dmxData[2] = 50;
    // light-lim: channels 4-6
    dmxData[3] = 10;
    dmxData[4] = 20;
    dmxData[5] = 30;
    sender.sendDmx(0, dmxData);

    // Wait for frame + scheduler ticks
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    sender.close();

    // Realtime scheduler should have dispatched
    assert.ok(mockAdapter.realtimeUpdates.length > 0, "Should have realtime updates dispatched");
    const rtUpdate = mockAdapter.realtimeUpdates[0];
    assert.equal(rtUpdate.bridgeId, "bridge-1");
    const rtEntity = rtUpdate.updates.find((u) => u.entityId === "light-rt");
    assert.ok(rtEntity, "Realtime entity should be in batch");

    // Limited scheduler should have dispatched
    assert.ok(mockAdapter.limitedUpdates.length > 0, "Should have limited updates dispatched");
    const limUpdate = mockAdapter.limitedUpdates.find((u) => u.entityId === "light-lim");
    assert.ok(limUpdate, "Limited entity should have been dispatched");
    assert.equal(limUpdate.bridgeId, "bridge-1");
  });

  it("creates separate LimitedScheduler per bridge per category", async () => {
    const lightEntity = makeEntity("light-1", "limited", "light");
    const groupEntity = makeBrightnessEntity("group-1", "limited", "group");
    const mockBridge = makeMockProtocolBridge([lightEntity, groupEntity], "bridge-1");
    const mockAdapter = new MockAdapter([mockBridge]);

    const port = getTestPort();
    const config = makeConfig([
      makeBridgeConfig("bridge-1", 0, [
        {
          targetId: "light-1",
          targetType: "light",
          dmxStart: 1,
          channelMode: "8bit",
        },
        {
          targetId: "group-1",
          targetType: "group",
          dmxStart: 4,
          channelMode: "brightness",
        },
      ]),
    ]);
    config.artnet.port = port;

    const factories = new Map<string, (bc: BridgeConfig) => ProtocolAdapter>();
    factories.set("mock", () => mockAdapter);

    const artnet = new ArtNetReceiver({ bindAddress: "127.0.0.1", port });
    orchestrator = new BridgeOrchestrator(config, artnet, factories);
    await orchestrator.start();

    // Send DMX data
    const sender = new ArtNetSender({ targetAddress: "127.0.0.1", port });
    await sender.waitReady();
    const dmxData = new Uint8Array(512);
    dmxData[0] = 100;
    dmxData[1] = 200;
    dmxData[2] = 50;
    dmxData[3] = 128; // brightness for group-1
    sender.sendDmx(0, dmxData);

    // Wait for frame + multiple scheduler ticks
    await new Promise<void>((resolve) => setTimeout(resolve, 2500));
    sender.close();

    // Both categories should have received updates
    const lightUpdates = mockAdapter.limitedUpdates.filter((u) => u.entityId === "light-1");
    const groupUpdates = mockAdapter.limitedUpdates.filter((u) => u.entityId === "group-1");
    assert.ok(lightUpdates.length > 0, "Light category should have dispatched");
    assert.ok(groupUpdates.length > 0, "Group category should have dispatched");
  });

  it("multiple bridges on same universe both receive data", async () => {
    // Two bridges both listening on universe 0
    const entity1 = makeEntity("light-a", "realtime", "realtime-light");
    const entity2 = makeEntity("light-b", "realtime", "realtime-light");
    const bridge1 = makeMockProtocolBridge([entity1], "bridge-a");
    const bridge2 = makeMockProtocolBridge([entity2], "bridge-b");

    const adapter1 = new MockAdapter([bridge1], "adapter-a");
    const adapter2 = new MockAdapter([bridge2], "adapter-b");

    const port = getTestPort();
    const config = makeConfig([
      makeBridgeConfig("bridge-a", 0, [
        {
          targetId: "light-a",
          targetType: "light",
          dmxStart: 1,
          channelMode: "8bit",
        },
      ]),
      makeBridgeConfig("bridge-b", 0, [
        {
          targetId: "light-b",
          targetType: "light",
          dmxStart: 4,
          channelMode: "8bit",
        },
      ]),
    ]);
    // Both bridges use the "mock" protocol but different adapter instances
    let adapterIndex = 0;
    const adapterList = [adapter1, adapter2];

    const factories = new Map<string, (bc: BridgeConfig) => ProtocolAdapter>();
    factories.set("mock", () => {
      const adapter = adapterList[adapterIndex];
      adapterIndex++;
      return adapter;
    });

    config.artnet.port = port;
    const artnet = new ArtNetReceiver({ bindAddress: "127.0.0.1", port });
    orchestrator = new BridgeOrchestrator(config, artnet, factories);
    await orchestrator.start();

    // Send DMX covering both entity ranges
    const sender = new ArtNetSender({ targetAddress: "127.0.0.1", port });
    await sender.waitReady();
    const dmxData = new Uint8Array(512);
    dmxData[0] = 255;
    dmxData[1] = 128;
    dmxData[2] = 64;
    dmxData[3] = 32;
    dmxData[4] = 16;
    dmxData[5] = 8;
    sender.sendDmx(0, dmxData);

    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    sender.close();

    assert.ok(adapter1.realtimeUpdates.length > 0, "First adapter should have received updates");
    assert.ok(adapter2.realtimeUpdates.length > 0, "Second adapter should have received updates");
    assert.equal(adapter1.realtimeUpdates[0].bridgeId, "bridge-a");
    assert.equal(adapter2.realtimeUpdates[0].bridgeId, "bridge-b");
  });

  it("aggregates status from all bridges", async () => {
    const realtimeEntity = makeEntity("light-rt", "realtime", "realtime-light");
    const limitedEntity = makeEntity("light-lim", "limited", "light");
    const mockBridge = makeMockProtocolBridge([realtimeEntity, limitedEntity], "bridge-1");
    const mockAdapter = new MockAdapter([mockBridge]);

    const port = getTestPort();
    const config = makeConfig([
      makeBridgeConfig("bridge-1", 0, [
        {
          targetId: "light-rt",
          targetType: "light",
          dmxStart: 1,
          channelMode: "8bit",
        },
        {
          targetId: "light-lim",
          targetType: "light",
          dmxStart: 4,
          channelMode: "8bit",
        },
      ]),
    ]);
    config.artnet.port = port;

    const factories = new Map<string, (bc: BridgeConfig) => ProtocolAdapter>();
    factories.set("mock", () => mockAdapter);

    const artnet = new ArtNetReceiver({ bindAddress: "127.0.0.1", port });
    orchestrator = new BridgeOrchestrator(config, artnet, factories);
    await orchestrator.start();

    const status = orchestrator.getStatus();
    assert.equal(status.artnet.running, true);
    assert.equal(status.artnet.frameCount, 0);

    const bridgeStatus = status.bridges["bridge-1"];
    assert.ok(bridgeStatus, "Bridge status should exist");
    assert.equal(bridgeStatus.connected, true);
    assert.equal(bridgeStatus.entityCount, 2);
    assert.equal(bridgeStatus.realtimeCount, 1);
    assert.equal(bridgeStatus.limitedCount, 1);
    assert.ok(
      "realtime-light" in bridgeStatus.rateLimitUsage,
      "Should have realtime-light rate limit",
    );
    assert.ok("light" in bridgeStatus.rateLimitUsage, "Should have light rate limit");
  });

  it("skips bridges with unknown protocol", async () => {
    const port = getTestPort();
    const config = makeConfig([
      makeBridgeConfig("bridge-unknown", 0, [
        {
          targetId: "light-1",
          targetType: "light",
          dmxStart: 1,
          channelMode: "8bit",
        },
      ]),
    ]);
    // Set the protocol to something unknown
    config.bridges[0].protocol = "zigbee";
    config.artnet.port = port;

    const factories = new Map<string, (bc: BridgeConfig) => ProtocolAdapter>();
    // No factory registered for "zigbee"

    const artnet = new ArtNetReceiver({ bindAddress: "127.0.0.1", port });
    orchestrator = new BridgeOrchestrator(config, artnet, factories);
    await orchestrator.start();

    const status = orchestrator.getStatus();
    assert.equal(Object.keys(status.bridges).length, 0);

    await orchestrator.stop();
    orchestrator = undefined;
  });

  it("handles ArtNet bind failure gracefully", async () => {
    const port = getTestPort();
    const config = makeConfig([]);
    config.artnet.port = port;

    // Bind the first receiver to claim the port
    const firstReceiver = new ArtNetReceiver({ bindAddress: "127.0.0.1", port });
    await firstReceiver.start();

    try {
      // Try to start an orchestrator on the same port
      const artnet = new ArtNetReceiver({ bindAddress: "127.0.0.1", port });
      const factories = new Map<string, (bc: BridgeConfig) => ProtocolAdapter>();
      orchestrator = new BridgeOrchestrator(config, artnet, factories);

      // ArtNetReceiver uses reuseAddr, so this may or may not fail depending on OS
      // The test verifies the orchestrator doesn't crash unexpectedly
      try {
        await orchestrator.start();
        await orchestrator.stop();
        orchestrator = undefined;
      } catch (err) {
        // Expected on some platforms — bind failure
        assert.ok(err instanceof Error);
        orchestrator = undefined;
      }
    } finally {
      await firstReceiver.stop();
    }
  });

  it("ignores DMX on universe with no mapped entities", async () => {
    const entity = makeEntity("light-1", "realtime", "realtime-light");
    const mockBridge = makeMockProtocolBridge([entity], "bridge-1");
    const mockAdapter = new MockAdapter([mockBridge]);

    const port = getTestPort();
    const config = makeConfig([
      makeBridgeConfig("bridge-1", 0, [
        {
          targetId: "light-1",
          targetType: "light",
          dmxStart: 1,
          channelMode: "8bit",
        },
      ]),
    ]);
    config.artnet.port = port;

    const factories = new Map<string, (bc: BridgeConfig) => ProtocolAdapter>();
    factories.set("mock", () => mockAdapter);

    const artnet = new ArtNetReceiver({ bindAddress: "127.0.0.1", port });
    orchestrator = new BridgeOrchestrator(config, artnet, factories);
    await orchestrator.start();

    // Send DMX on universe 5 (no mappings there)
    const sender = new ArtNetSender({ targetAddress: "127.0.0.1", port });
    await sender.waitReady();
    const dmxData = new Uint8Array(512);
    dmxData[0] = 255;
    sender.sendDmx(5, dmxData);

    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    sender.close();

    // Frame count should include all universes, but no updates dispatched
    const status = orchestrator.getStatus();
    assert.ok((status.artnet.frameCounts[5] ?? 0) > 0, "Universe 5 frames should be counted");
    assert.equal(
      mockAdapter.realtimeUpdates.length,
      0,
      "No realtime updates for unmapped universe",
    );
  });
});
