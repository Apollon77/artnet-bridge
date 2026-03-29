import * as assert from "node:assert/strict";
import type { DiscoveredBridge, PairingResult, EntityUpdate } from "@artnet-bridge/protocol";
import type {
  HueClipClient,
  HueLight,
  HueRoom,
  HueZone,
  HueGroupedLight,
  HueScene,
  HueEntertainmentConfiguration,
} from "../src/HueClipClient.js";
import type { HueDtlsStream, ColorUpdate } from "../src/HueDtlsStream.js";
import { HueProtocolAdapter } from "../src/HueProtocolAdapter.js";
import type { HueAdapterConfig } from "../src/HueProtocolAdapter.js";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const LIGHTS: HueLight[] = [
  { id: "light-1", metadata: { name: "Desk lamp" }, type: "light", color: { gamut_type: "C" } },
  { id: "light-2", metadata: { name: "Ceiling" }, type: "light", color: { gamut_type: "C" } },
  { id: "light-3", metadata: { name: "Floor lamp" }, type: "light", color: { gamut_type: "C" } },
  { id: "light-4", metadata: { name: "TV Backlight" }, type: "light", color: { gamut_type: "C" } },
];

const ROOMS: HueRoom[] = [
  {
    id: "room-1",
    metadata: { name: "Living room" },
    type: "room",
    children: [
      { rid: "light-1", rtype: "light" },
      { rid: "light-2", rtype: "light" },
    ],
    services: [{ rid: "gl-1", rtype: "grouped_light" }],
  },
];

const ZONES: HueZone[] = [
  {
    id: "zone-1",
    metadata: { name: "Upstairs" },
    type: "zone",
    children: [{ rid: "light-3", rtype: "light" }],
    services: [{ rid: "gl-2", rtype: "grouped_light" }],
  },
];

const GROUPED_LIGHTS: HueGroupedLight[] = [
  { id: "gl-1", owner: { rid: "room-1", rtype: "room" }, type: "grouped_light" },
  { id: "gl-2", owner: { rid: "zone-1", rtype: "zone" }, type: "grouped_light" },
];

const SCENES: HueScene[] = [
  {
    id: "scene-1",
    metadata: { name: "Relax" },
    group: { rid: "room-1", rtype: "room" },
    type: "scene",
  },
  {
    id: "scene-2",
    metadata: { name: "Energize" },
    group: { rid: "room-1", rtype: "room" },
    type: "scene",
  },
];

const ENT_CONFIG_ID = "12345678-1234-1234-1234-123456789abc";

const ENTERTAINMENT_CONFIGS: HueEntertainmentConfiguration[] = [
  {
    id: ENT_CONFIG_ID,
    metadata: { name: "TV area" },
    type: "entertainment_configuration",
    status: "inactive",
    channels: [
      {
        channel_id: 0,
        position: { x: -1, y: 0, z: 0 },
        members: [{ service: { rid: "light-3", rtype: "entertainment" }, index: 0 }],
      },
      {
        channel_id: 1,
        position: { x: 1, y: 0, z: 0 },
        members: [{ service: { rid: "light-4", rtype: "entertainment" }, index: 0 }],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

interface MockClientCalls {
  setLightState: Array<{ id: string; state: Record<string, unknown> }>;
  setGroupedLightState: Array<{ id: string; state: Record<string, unknown> }>;
  activateScene: Array<{ id: string }>;
  startEntertainment: Array<{ id: string }>;
  stopEntertainment: Array<{ id: string }>;
  getApplicationId: number;
}

function createMockClient(
  calls: MockClientCalls,
  overrides?: {
    lights?: HueLight[];
    rooms?: HueRoom[];
    zones?: HueZone[];
    groupedLights?: HueGroupedLight[];
    scenes?: HueScene[];
    entertainmentConfigs?: HueEntertainmentConfiguration[];
  },
): HueClipClient {
  return {
    getLights: async () => overrides?.lights ?? LIGHTS,
    getRooms: async () => overrides?.rooms ?? ROOMS,
    getZones: async () => overrides?.zones ?? ZONES,
    getGroupedLights: async () => overrides?.groupedLights ?? GROUPED_LIGHTS,
    getScenes: async () => overrides?.scenes ?? SCENES,
    getEntertainmentConfigurations: async () =>
      overrides?.entertainmentConfigs ?? ENTERTAINMENT_CONFIGS,
    getEntertainmentServices: async () => [],
    setLightState: async (id: string, state: Record<string, unknown>) => {
      calls.setLightState.push({ id, state });
    },
    setGroupedLightState: async (id: string, state: Record<string, unknown>) => {
      calls.setGroupedLightState.push({ id, state });
    },
    activateScene: async (id: string) => {
      calls.activateScene.push({ id });
    },
    startEntertainment: async (id: string) => {
      calls.startEntertainment.push({ id });
    },
    stopEntertainment: async (id: string) => {
      calls.stopEntertainment.push({ id });
    },
    getApplicationId: async () => {
      calls.getApplicationId++;
      return "mock-app-id";
    },
    createUser: async () => ({ username: "u", clientkey: "k" }),
  } as unknown as HueClipClient;
}

interface MockDtlsCalls {
  connect: number;
  close: number;
  updateValues: ColorUpdate[][];
}

function createMockDtlsStream(calls: MockDtlsCalls): HueDtlsStream {
  return {
    connected: true,
    connect: async () => {
      calls.connect++;
    },
    close: async () => {
      calls.close++;
    },
    updateValues: (updates: ReadonlyArray<ColorUpdate>) => {
      calls.updateValues.push([...updates]);
    },
  } as unknown as HueDtlsStream;
}

function freshClientCalls(): MockClientCalls {
  return {
    setLightState: [],
    setGroupedLightState: [],
    activateScene: [],
    startEntertainment: [],
    stopEntertainment: [],
    getApplicationId: 0,
  };
}

function freshDtlsCalls(): MockDtlsCalls {
  return { connect: 0, close: 0, updateValues: [] };
}

// ---------------------------------------------------------------------------
// Helper to build a configured adapter with mocks
// ---------------------------------------------------------------------------

function buildAdapter(options?: {
  entertainmentConfigId?: string;
  clientCalls?: MockClientCalls;
  dtlsCalls?: MockDtlsCalls;
  clientOverrides?: Parameters<typeof createMockClient>[1];
}): {
  adapter: HueProtocolAdapter;
  clientCalls: MockClientCalls;
  dtlsCalls: MockDtlsCalls;
} {
  const clientCalls = options?.clientCalls ?? freshClientCalls();
  const dtlsCalls = options?.dtlsCalls ?? freshDtlsCalls();

  const config: HueAdapterConfig = {
    bridges: [
      {
        id: "bridge-1",
        name: "Test Bridge",
        connection: { host: "192.168.1.100", username: "testuser", clientkey: "aabbccdd" },
        entertainmentConfigId: options?.entertainmentConfigId,
      },
    ],
  };

  const adapter = new HueProtocolAdapter(config, {
    createClipClient: () => createMockClient(clientCalls, options?.clientOverrides),
    createDtlsStream: () => createMockDtlsStream(dtlsCalls),
    discoverFn: async () => [],
    pairFn: async () => ({ success: true }),
  });

  return { adapter, clientCalls, dtlsCalls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HueProtocolAdapter", () => {
  // -----------------------------------------------------------------------
  // getBridges
  // -----------------------------------------------------------------------

  describe("getBridges()", () => {
    it("should return correct ProtocolBridge structure", async () => {
      const { adapter } = buildAdapter();
      await adapter.connect();

      const bridges = await adapter.getBridges();
      assert.equal(bridges.length, 1);
      assert.equal(bridges[0].id, "bridge-1");
      assert.equal(bridges[0].metadata.name, "Test Bridge");
      assert.equal(bridges[0].metadata.host, "192.168.1.100");
      assert.ok(Array.isArray(bridges[0].entities));
      assert.ok(bridges[0].rateLimits !== undefined);
    });

    it("should map all lights as limited when no entertainment area is configured", async () => {
      // Pass empty entertainment configs to prevent auto-select
      const { adapter } = buildAdapter({
        clientOverrides: { entertainmentConfigs: [] },
      });
      await adapter.connect();

      const bridges = await adapter.getBridges();
      const lightEntities = bridges[0].entities.filter((e) => e.category === "light");
      assert.equal(lightEntities.length, 4); // all 4 lights

      for (const entity of lightEntities) {
        assert.equal(entity.controlMode, "limited");
        assert.equal(entity.category, "light");
        assert.deepEqual(entity.channelLayout, { type: "rgb" });
      }
    });

    it("should include room and zone group entities", async () => {
      const { adapter } = buildAdapter();
      await adapter.connect();

      const bridges = await adapter.getBridges();
      const groupEntities = bridges[0].entities.filter((e) => e.category === "group");
      assert.equal(groupEntities.length, 2); // 1 room + 1 zone
      assert.equal(groupEntities[0].controlMode, "limited");
      // Groups with color-capable lights get rgb layout
      assert.deepEqual(groupEntities[0].channelLayout, { type: "rgb" });
    });

    it("should include scene selector entities for groups with scenes", async () => {
      const { adapter } = buildAdapter();
      await adapter.connect();

      const bridges = await adapter.getBridges();
      const sceneEntities = bridges[0].entities.filter((e) => e.category === "scene");
      assert.equal(sceneEntities.length, 1); // Only room-1 has scenes
      assert.equal(sceneEntities[0].controlMode, "limited");

      const layout = sceneEntities[0].channelLayout;
      assert.equal(layout.type, "scene-selector");
      if (layout.type === "scene-selector") {
        assert.equal(layout.scenes.length, 2);
        assert.equal(layout.scenes[0].sceneId, "scene-1");
        assert.equal(layout.scenes[0].name, "Relax");
        assert.equal(layout.scenes[1].sceneId, "scene-2");
        assert.equal(layout.scenes[1].name, "Energize");
      }
    });
  });

  // -----------------------------------------------------------------------
  // Entertainment area handling
  // -----------------------------------------------------------------------

  describe("entertainment area", () => {
    it("should mark entertainment lights as realtime", async () => {
      const { adapter } = buildAdapter({ entertainmentConfigId: ENT_CONFIG_ID });
      await adapter.connect();

      const bridges = await adapter.getBridges();
      const realtimeEntities = bridges[0].entities.filter((e) => e.controlMode === "realtime");
      assert.equal(realtimeEntities.length, 2); // light-3 and light-4
      for (const entity of realtimeEntities) {
        assert.equal(entity.category, "realtime-light");
        assert.deepEqual(entity.channelLayout, { type: "rgb" });
      }
    });

    it("should exclude entertainment lights from limited category", async () => {
      const { adapter } = buildAdapter({ entertainmentConfigId: ENT_CONFIG_ID });
      await adapter.connect();

      const bridges = await adapter.getBridges();
      const limitedLights = bridges[0].entities.filter((e) => e.category === "light");

      // light-3 and light-4 are in entertainment, so only light-1 and light-2 remain
      assert.equal(limitedLights.length, 2);
      const limitedIds = limitedLights.map((e) => e.id);
      assert.ok(limitedIds.includes("light-1"));
      assert.ok(limitedIds.includes("light-2"));
      assert.ok(!limitedIds.includes("light-3"));
      assert.ok(!limitedIds.includes("light-4"));
    });

    it("should start entertainment streaming on connect", async () => {
      const clientCalls = freshClientCalls();
      const dtlsCalls = freshDtlsCalls();
      const { adapter } = buildAdapter({
        entertainmentConfigId: ENT_CONFIG_ID,
        clientCalls,
        dtlsCalls,
      });
      await adapter.connect();

      assert.equal(clientCalls.getApplicationId, 1);
      assert.equal(clientCalls.startEntertainment.length, 1);
      assert.equal(clientCalls.startEntertainment[0].id, ENT_CONFIG_ID);
      assert.equal(dtlsCalls.connect, 1);
    });
  });

  // -----------------------------------------------------------------------
  // Rate limits
  // -----------------------------------------------------------------------

  describe("rate limits", () => {
    it("should declare correct rate limits", async () => {
      const { adapter } = buildAdapter();
      await adapter.connect();

      const bridges = await adapter.getBridges();
      const limits = bridges[0].rateLimits;

      assert.equal(limits["realtime-light"].maxPerSecond, 6);
      assert.equal(limits["realtime-light"].defaultPerSecond, 6);
      assert.equal(limits["light"].maxPerSecond, 10);
      assert.equal(limits["light"].defaultPerSecond, 10);
      assert.equal(limits["group"].maxPerSecond, 1);
      assert.equal(limits["group"].defaultPerSecond, 1);
      assert.equal(limits["scene"].maxPerSecond, 1);
      assert.equal(limits["scene"].defaultPerSecond, 1);
    });
  });

  // -----------------------------------------------------------------------
  // handleRealtimeUpdate
  // -----------------------------------------------------------------------

  describe("handleRealtimeUpdate()", () => {
    it("should pass updates to DTLS stream mapped to channel IDs", async () => {
      const dtlsCalls = freshDtlsCalls();
      const { adapter } = buildAdapter({
        entertainmentConfigId: ENT_CONFIG_ID,
        dtlsCalls,
      });
      await adapter.connect();

      const updates: EntityUpdate[] = [
        { entityId: "light-3", value: { type: "rgb", r: 65535, g: 0, b: 0 } },
        { entityId: "light-4", value: { type: "rgb", r: 0, g: 65535, b: 0 } },
      ];
      await adapter.handleRealtimeUpdate("bridge-1", updates);

      assert.equal(dtlsCalls.updateValues.length, 1);
      const sent = dtlsCalls.updateValues[0];
      assert.equal(sent.length, 2);

      // light-3 is channel 0, light-4 is channel 1
      const ch0 = sent.find((u) => u.channelId === 0);
      const ch1 = sent.find((u) => u.channelId === 1);
      assert.ok(ch0 !== undefined);
      assert.ok(ch1 !== undefined);
      assert.deepEqual(ch0.color, [65535, 0, 0]);
      assert.deepEqual(ch1.color, [0, 65535, 0]);
    });

    it("should ignore updates for unknown entities", async () => {
      const dtlsCalls = freshDtlsCalls();
      const { adapter } = buildAdapter({
        entertainmentConfigId: ENT_CONFIG_ID,
        dtlsCalls,
      });
      await adapter.connect();

      const updates: EntityUpdate[] = [
        { entityId: "unknown-light", value: { type: "rgb", r: 100, g: 200, b: 300 } },
      ];
      await adapter.handleRealtimeUpdate("bridge-1", updates);

      // No valid updates -> nothing sent
      assert.equal(dtlsCalls.updateValues.length, 0);
    });
  });

  // -----------------------------------------------------------------------
  // handleLimitedUpdate
  // -----------------------------------------------------------------------

  describe("handleLimitedUpdate()", () => {
    it("should call setLightState for light entities and await response", async () => {
      const clientCalls = freshClientCalls();
      const { adapter } = buildAdapter({ clientCalls });
      await adapter.connect();

      // handleLimitedUpdate must await the REST call
      await adapter.handleLimitedUpdate("bridge-1", "light-1", {
        type: "rgb",
        r: 65535,
        g: 0,
        b: 0,
      });

      assert.equal(clientCalls.setLightState.length, 1);
      assert.equal(clientCalls.setLightState[0].id, "light-1");
      // Should have color.xy and dimming
      const state = clientCalls.setLightState[0].state;
      assert.ok("color" in state);
      assert.ok("dimming" in state);
    });

    it("should call activateScene for scene entities", async () => {
      const clientCalls = freshClientCalls();
      const { adapter } = buildAdapter({ clientCalls });
      await adapter.connect();

      await adapter.handleLimitedUpdate("bridge-1", "room-1-scenes", {
        type: "scene-selector",
        sceneId: "scene-1",
      });

      assert.equal(clientCalls.activateScene.length, 1);
      assert.equal(clientCalls.activateScene[0].id, "scene-1");
    });

    it("should call setGroupedLightState for group entities", async () => {
      const clientCalls = freshClientCalls();
      const { adapter } = buildAdapter({ clientCalls });
      await adapter.connect();

      await adapter.handleLimitedUpdate("bridge-1", "gl-1", {
        type: "brightness",
        value: 32768,
      });

      assert.equal(clientCalls.setGroupedLightState.length, 1);
      assert.equal(clientCalls.setGroupedLightState[0].id, "gl-1");
      const state = clientCalls.setGroupedLightState[0].state;
      assert.ok("dimming" in state);
    });
  });

  // -----------------------------------------------------------------------
  // discover and pair
  // -----------------------------------------------------------------------

  describe("discover()", () => {
    it("should delegate to the discovery function", async () => {
      let called = false;
      const expectedBridges: DiscoveredBridge[] = [
        { id: "b1", host: "192.168.1.1", protocol: "hue", metadata: {} },
      ];

      const adapter = new HueProtocolAdapter(
        { bridges: [] },
        {
          createClipClient: () => createMockClient(freshClientCalls()),
          createDtlsStream: () => createMockDtlsStream(freshDtlsCalls()),
          discoverFn: async () => {
            called = true;
            return expectedBridges;
          },
          pairFn: async () => ({ success: true }),
        },
      );

      const result = await adapter.discover();
      assert.ok(called);
      assert.deepEqual(result, expectedBridges);
    });
  });

  describe("pair()", () => {
    it("should delegate to the pairing function", async () => {
      let pairedHost = "";
      const expectedResult: PairingResult = {
        success: true,
        connection: { host: "192.168.1.50", username: "u", clientkey: "k" },
      };

      const adapter = new HueProtocolAdapter(
        { bridges: [] },
        {
          createClipClient: () => createMockClient(freshClientCalls()),
          createDtlsStream: () => createMockDtlsStream(freshDtlsCalls()),
          discoverFn: async () => [],
          pairFn: async (host: string) => {
            pairedHost = host;
            return expectedResult;
          },
        },
      );

      const target: DiscoveredBridge = {
        id: "b1",
        host: "192.168.1.50",
        protocol: "hue",
        metadata: {},
      };
      const result = await adapter.pair(target);
      assert.equal(pairedHost, "192.168.1.50");
      assert.deepEqual(result, expectedResult);
    });
  });

  // -----------------------------------------------------------------------
  // disconnect
  // -----------------------------------------------------------------------

  describe("disconnect()", () => {
    it("should close DTLS stream and stop entertainment", async () => {
      const clientCalls = freshClientCalls();
      const dtlsCalls = freshDtlsCalls();
      const { adapter } = buildAdapter({
        entertainmentConfigId: ENT_CONFIG_ID,
        clientCalls,
        dtlsCalls,
      });
      await adapter.connect();

      await adapter.disconnect();

      assert.equal(dtlsCalls.close, 1);
      assert.equal(clientCalls.stopEntertainment.length, 1);
      assert.equal(clientCalls.stopEntertainment[0].id, ENT_CONFIG_ID);

      // After disconnect, getBridges returns empty
      const bridges = await adapter.getBridges();
      assert.equal(bridges.length, 0);
    });
  });

  // -----------------------------------------------------------------------
  // getStatus
  // -----------------------------------------------------------------------

  describe("getStatus()", () => {
    it("should return connected status after connect", async () => {
      const { adapter } = buildAdapter({ entertainmentConfigId: ENT_CONFIG_ID });
      await adapter.connect();

      const status = adapter.getStatus();
      assert.equal(status.connected, true);
      assert.ok(status.bridges["bridge-1"] !== undefined);
      assert.equal(status.bridges["bridge-1"].connected, true);
      assert.equal(status.bridges["bridge-1"].streaming, true);
    });

    it("should report not connected before connect", () => {
      const { adapter } = buildAdapter();
      const status = adapter.getStatus();
      assert.equal(status.connected, false);
    });
  });
});
