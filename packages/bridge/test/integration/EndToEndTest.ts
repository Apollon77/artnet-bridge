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
import type { AppConfig, BridgeConfig } from "../../src/config/ConfigSchema.js";
import { ConfigManager } from "../../src/config/ConfigManager.js";
import { BridgeOrchestrator } from "../../src/BridgeOrchestrator.js";
import { WebServer } from "../../src/web/WebServer.js";
import WebSocket from "ws";

// --- Mock Protocol Adapter ---

class MockProtocolAdapter implements ProtocolAdapter {
  readonly id = "mock-adapter";
  readonly name = "Mock Adapter";
  readonly type = "mock";

  realtimeUpdates: Array<{ bridgeId: string; updates: EntityUpdate[] }> = [];
  limitedUpdates: Array<{ bridgeId: string; entityId: string; value: EntityValue }> = [];
  connectCalled = false;
  disconnectCalled = false;

  private readonly bridges: ProtocolBridge[];

  constructor(bridges: ProtocolBridge[]) {
    this.bridges = bridges;
  }

  async connect(): Promise<void> {
    this.connectCalled = true;
  }
  async disconnect(): Promise<void> {
    this.disconnectCalled = true;
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
      bridges[b.id] = { connected: true, streaming: true, stats: {} };
    }
    return { connected: true, bridges };
  }
}

// --- Test helpers ---

function makeProtocolBridge(entities: Entity[]): ProtocolBridge {
  return {
    id: "mock-bridge-1",
    metadata: { name: "Mock Bridge", host: "localhost" },
    entities,
    rateLimits: {
      "realtime-light": { maxPerSecond: 6, defaultPerSecond: 6, description: "Realtime" },
      light: { maxPerSecond: 10, defaultPerSecond: 10, description: "Light" },
      group: { maxPerSecond: 1, defaultPerSecond: 1, description: "Group" },
    },
  };
}

function makeEntity(
  id: string,
  controlMode: "realtime" | "limited",
  category: string,
  layoutType: "rgb" | "brightness" = "rgb",
): Entity {
  return {
    id,
    metadata: { name: id, type: "light" },
    controlMode,
    category,
    channelLayout: { type: layoutType },
  };
}

function makeConfig(bridgeConfigs: BridgeConfig[], artnetPort: number, webPort: number): AppConfig {
  return {
    version: 1,
    artnet: { bindAddress: "127.0.0.1", port: artnetPort },
    web: { port: webPort, enabled: false },
    bridges: bridgeConfigs,
  };
}

function makeBridgeConfig(
  universe: number,
  mappings: Array<{
    targetId: string;
    targetType: string;
    dmxStart: number;
    channelMode: "8bit" | "8bit-dimmable" | "16bit" | "scene-selector" | "brightness";
  }>,
): BridgeConfig {
  return {
    id: "mock-bridge-1",
    protocol: "mock",
    connection: {},
    universe,
    channelMappings: mappings,
  };
}

let nextPort = 40000 + Math.floor(Math.random() * 10000);
function getTestPort(): number {
  return nextPort++;
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// --- Tests ---

describe("End-to-end integration", () => {
  let orchestrator: BridgeOrchestrator | undefined;
  let sender: ArtNetSender | undefined;
  let webServer: WebServer | undefined;

  afterEach(async () => {
    if (sender) {
      sender.close();
      sender = undefined;
    }
    if (orchestrator) {
      await orchestrator.stop();
      orchestrator = undefined;
    }
    if (webServer) {
      await webServer.stop();
      webServer = undefined;
    }
  });

  it("full pipeline: ArtNet -> mock adapter (realtime)", async () => {
    const artnetPort = getTestPort();
    const light1 = makeEntity("light-1", "realtime", "realtime-light");
    const protocolBridge = makeProtocolBridge([light1]);
    const mockAdapter = new MockProtocolAdapter([protocolBridge]);

    const bridgeConfig = makeBridgeConfig(0, [
      { targetId: "light-1", targetType: "light", dmxStart: 1, channelMode: "8bit" },
    ]);
    const config = makeConfig([bridgeConfig], artnetPort, 0);

    const factories = new Map<string, (bc: BridgeConfig) => ProtocolAdapter>();
    factories.set("mock", () => mockAdapter);

    const artnet = new ArtNetReceiver({ bindAddress: "127.0.0.1", port: artnetPort });
    orchestrator = new BridgeOrchestrator(config, artnet, factories);
    await orchestrator.start();

    // Send DMX data via ArtNetSender
    sender = new ArtNetSender({ targetAddress: "127.0.0.1", port: artnetPort });
    await sender.waitReady();
    const dmxData = new Uint8Array(512);
    dmxData[0] = 255; // R
    dmxData[1] = 128; // G
    dmxData[2] = 64; // B
    sender.sendDmx(0, dmxData);

    // Wait for UDP delivery + realtime scheduler tick (~167ms at 6Hz)
    await delay(400);

    assert.ok(mockAdapter.realtimeUpdates.length > 0, "Should have received realtime updates");
    const batch = mockAdapter.realtimeUpdates[0];
    assert.equal(batch.bridgeId, "mock-bridge-1");
    const entityUpdate = batch.updates.find((u) => u.entityId === "light-1");
    assert.ok(entityUpdate, "light-1 should be in the realtime batch");

    // 8bit mode scales by 257: 255*257=65535, 128*257=32896, 64*257=16448
    const val = entityUpdate.value;
    assert.equal(val.type, "rgb");
    if (val.type === "rgb") {
      assert.equal(val.r, 255 * 257);
      assert.equal(val.g, 128 * 257);
      assert.equal(val.b, 64 * 257);
    }
  });

  it("full pipeline: ArtNet -> mock adapter (limited)", async () => {
    const artnetPort = getTestPort();
    const light2 = makeEntity("light-2", "limited", "light");
    const protocolBridge = makeProtocolBridge([light2]);
    const mockAdapter = new MockProtocolAdapter([protocolBridge]);

    const bridgeConfig = makeBridgeConfig(0, [
      { targetId: "light-2", targetType: "light", dmxStart: 4, channelMode: "8bit" },
    ]);
    const config = makeConfig([bridgeConfig], artnetPort, 0);

    const factories = new Map<string, (bc: BridgeConfig) => ProtocolAdapter>();
    factories.set("mock", () => mockAdapter);

    const artnet = new ArtNetReceiver({ bindAddress: "127.0.0.1", port: artnetPort });
    orchestrator = new BridgeOrchestrator(config, artnet, factories);
    await orchestrator.start();

    sender = new ArtNetSender({ targetAddress: "127.0.0.1", port: artnetPort });
    await sender.waitReady();
    const dmxData = new Uint8Array(512);
    dmxData[3] = 200; // R (channel 4, 0-indexed=3)
    dmxData[4] = 100; // G
    dmxData[5] = 50; // B
    sender.sendDmx(0, dmxData);

    // Wait for limited scheduler tick (~100ms at 10Hz)
    await delay(400);

    assert.ok(mockAdapter.limitedUpdates.length > 0, "Should have received limited updates");
    const update = mockAdapter.limitedUpdates.find((u) => u.entityId === "light-2");
    assert.ok(update, "light-2 should have been dispatched");
    assert.equal(update.bridgeId, "mock-bridge-1");

    const val = update.value;
    assert.equal(val.type, "rgb");
    if (val.type === "rgb") {
      assert.equal(val.r, 200 * 257);
      assert.equal(val.g, 100 * 257);
      assert.equal(val.b, 50 * 257);
    }
  });

  it("rate limiting respects budget", async () => {
    const artnetPort = getTestPort();
    // group category has rate limit of 1/sec
    const group1 = makeEntity("group-1", "limited", "group", "brightness");
    const protocolBridge = makeProtocolBridge([group1]);
    const mockAdapter = new MockProtocolAdapter([protocolBridge]);

    const bridgeConfig = makeBridgeConfig(0, [
      { targetId: "group-1", targetType: "group", dmxStart: 1, channelMode: "brightness" },
    ]);
    const config = makeConfig([bridgeConfig], artnetPort, 0);

    const factories = new Map<string, (bc: BridgeConfig) => ProtocolAdapter>();
    factories.set("mock", () => mockAdapter);

    const artnet = new ArtNetReceiver({ bindAddress: "127.0.0.1", port: artnetPort });
    orchestrator = new BridgeOrchestrator(config, artnet, factories);
    await orchestrator.start();

    sender = new ArtNetSender({ targetAddress: "127.0.0.1", port: artnetPort });
    await sender.waitReady();

    // Send many rapid DMX updates over ~500ms
    for (let i = 0; i < 10; i++) {
      const dmxData = new Uint8Array(512);
      dmxData[0] = 50 + i * 10;
      sender.sendDmx(0, dmxData);
      await delay(50);
    }

    // Wait for scheduler to finish processing
    await delay(600);

    // group rate is 1/sec = ~1000ms interval, so in ~1.1 seconds total
    // we should have at most 2 dispatches (one near t=0, one near t=1000)
    assert.ok(
      mockAdapter.limitedUpdates.length <= 3,
      `Expected at most 3 dispatches at 1/sec rate, got ${mockAdapter.limitedUpdates.length}`,
    );
    assert.ok(mockAdapter.limitedUpdates.length >= 1, "Should have at least 1 dispatch");
  });

  it("multiple entities from single DMX frame", async () => {
    const artnetPort = getTestPort();
    const light1 = makeEntity("light-1", "realtime", "realtime-light");
    const light2 = makeEntity("light-2", "limited", "light");
    const protocolBridge = makeProtocolBridge([light1, light2]);
    const mockAdapter = new MockProtocolAdapter([protocolBridge]);

    const bridgeConfig = makeBridgeConfig(0, [
      { targetId: "light-1", targetType: "light", dmxStart: 1, channelMode: "8bit" },
      { targetId: "light-2", targetType: "light", dmxStart: 4, channelMode: "8bit" },
    ]);
    const config = makeConfig([bridgeConfig], artnetPort, 0);

    const factories = new Map<string, (bc: BridgeConfig) => ProtocolAdapter>();
    factories.set("mock", () => mockAdapter);

    const artnet = new ArtNetReceiver({ bindAddress: "127.0.0.1", port: artnetPort });
    orchestrator = new BridgeOrchestrator(config, artnet, factories);
    await orchestrator.start();

    // Send one DMX frame with data for both entities
    sender = new ArtNetSender({ targetAddress: "127.0.0.1", port: artnetPort });
    await sender.waitReady();
    const dmxData = new Uint8Array(512);
    // light-1: channels 1-3 (RGB)
    dmxData[0] = 255;
    dmxData[1] = 128;
    dmxData[2] = 64;
    // light-2: channels 4-6 (RGB)
    dmxData[3] = 10;
    dmxData[4] = 20;
    dmxData[5] = 30;
    sender.sendDmx(0, dmxData);

    // Wait for both schedulers to tick
    await delay(500);

    // light-1 is realtime
    assert.ok(mockAdapter.realtimeUpdates.length > 0, "Should have realtime updates");
    const rtBatch = mockAdapter.realtimeUpdates[0];
    const rtEntity = rtBatch.updates.find((u) => u.entityId === "light-1");
    assert.ok(rtEntity, "light-1 should be in realtime batch");

    // light-2 is limited
    assert.ok(mockAdapter.limitedUpdates.length > 0, "Should have limited updates");
    const limUpdate = mockAdapter.limitedUpdates.find((u) => u.entityId === "light-2");
    assert.ok(limUpdate, "light-2 should have been dispatched");
  });

  it("WebSocket integration", async () => {
    const artnetPort = getTestPort();
    const webPort = getTestPort();

    const light1 = makeEntity("light-1", "realtime", "realtime-light");
    const protocolBridge = makeProtocolBridge([light1]);
    const mockAdapter = new MockProtocolAdapter([protocolBridge]);

    const bridgeConfig = makeBridgeConfig(0, [
      { targetId: "light-1", targetType: "light", dmxStart: 1, channelMode: "8bit" },
    ]);
    const config = makeConfig([bridgeConfig], artnetPort, webPort);

    const factories = new Map<string, (bc: BridgeConfig) => ProtocolAdapter>();
    factories.set("mock", () => mockAdapter);

    const artnet = new ArtNetReceiver({ bindAddress: "127.0.0.1", port: artnetPort });
    orchestrator = new BridgeOrchestrator(config, artnet, factories);
    await orchestrator.start();

    // Start WebServer
    const tmpDir = `/tmp/artnet-bridge-test-${Date.now()}`;
    const configManager = new ConfigManager(`${tmpDir}/config.json`);
    webServer = new WebServer({
      port: webPort,
      orchestrator,
      configManager,
      adapters: [mockAdapter],
    });
    await webServer.start();

    const actualPort = webServer.address?.port ?? webPort;

    // Connect WebSocket client
    const ws = new WebSocket(`ws://127.0.0.1:${actualPort}/ws`);
    const messages: Array<Record<string, unknown>> = [];

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WS connect timeout")), 3000);
      ws.on("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      ws.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    ws.on("message", (data) => {
      const parsed: unknown = JSON.parse(String(data));
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        messages.push(parsed as Record<string, unknown>);
      }
    });

    // Subscribe to bridge status
    ws.send(JSON.stringify({ type: "subscribe", bridgeId: "mock-bridge-1" }));

    // Send DMX data to trigger activity
    sender = new ArtNetSender({ targetAddress: "127.0.0.1", port: artnetPort });
    await sender.waitReady();
    const dmxData = new Uint8Array(512);
    dmxData[0] = 100;
    dmxData[1] = 200;
    dmxData[2] = 50;
    sender.sendDmx(0, dmxData);

    // Wait for WebSocket push interval (500ms) + buffer
    await delay(1500);

    ws.close();

    assert.ok(messages.length > 0, "Should have received WebSocket status messages");
    const statusMsg = messages.find((m) => m["type"] === "status");
    assert.ok(statusMsg, "Should have a status-type message");
    assert.equal(statusMsg["bridgeId"], "mock-bridge-1");
    assert.ok(statusMsg["data"], "Status message should have data");
  });

  it("adapter connect/disconnect lifecycle", async () => {
    const artnetPort = getTestPort();
    const light1 = makeEntity("light-1", "realtime", "realtime-light");
    const protocolBridge = makeProtocolBridge([light1]);
    const mockAdapter = new MockProtocolAdapter([protocolBridge]);

    const bridgeConfig = makeBridgeConfig(0, [
      { targetId: "light-1", targetType: "light", dmxStart: 1, channelMode: "8bit" },
    ]);
    const config = makeConfig([bridgeConfig], artnetPort, 0);

    const factories = new Map<string, (bc: BridgeConfig) => ProtocolAdapter>();
    factories.set("mock", () => mockAdapter);

    const artnet = new ArtNetReceiver({ bindAddress: "127.0.0.1", port: artnetPort });
    orchestrator = new BridgeOrchestrator(config, artnet, factories);

    assert.equal(mockAdapter.connectCalled, false);
    assert.equal(mockAdapter.disconnectCalled, false);

    await orchestrator.start();
    assert.equal(mockAdapter.connectCalled, true, "connect() should be called on start");

    await orchestrator.stop();
    assert.equal(mockAdapter.disconnectCalled, true, "disconnect() should be called on stop");
    orchestrator = undefined;
  });
});
