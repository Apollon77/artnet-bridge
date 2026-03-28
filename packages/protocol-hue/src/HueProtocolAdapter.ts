import type {
  ProtocolAdapter,
  ProtocolBridge,
  Entity,
  DiscoveredBridge,
  PairingResult,
  AdapterStatus,
  BridgeStatus,
  RateLimitBudget,
  ChannelLayout,
  SceneEntry,
  EntityUpdate,
  EntityValue,
} from "@artnet-bridge/protocol";
import {
  HueClipClient as HueClipClientImpl,
  type HueLight,
  type HueRoom,
  type HueZone,
  type HueGroupedLight,
  type HueScene,
  type HueEntertainmentConfiguration,
} from "./HueClipClient.js";
import { HueDtlsStream as HueDtlsStreamImpl, type ColorUpdate } from "./HueDtlsStream.js";
import { discoverBridges as discoverBridgesImpl } from "./HueDiscovery.js";
import { pairWithBridge as pairWithBridgeImpl } from "./HuePairing.js";

// Re-export the interfaces used by the dependency injection types
type HueClipClient = HueClipClientImpl;
type HueDtlsStream = HueDtlsStreamImpl;

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

export interface HueBridgeConnection {
  host: string;
  username: string;
  clientkey: string;
}

export interface HueBridgeConfig {
  id: string;
  name?: string;
  connection: HueBridgeConnection;
  entertainmentConfigId?: string;
}

export interface HueAdapterConfig {
  bridges: HueBridgeConfig[];
}

// ---------------------------------------------------------------------------
// Dependency injection interfaces
// ---------------------------------------------------------------------------

/**
 * Factory for creating HueClipClient instances.
 * Tests can inject mock implementations.
 */
export type CreateClipClient = (host: string, username: string) => HueClipClient;

/**
 * Factory for creating HueDtlsStream instances.
 * Tests can inject mock implementations.
 */
export type CreateDtlsStream = (
  host: string,
  pskIdentity: string,
  clientKey: string,
  entertainmentConfigId: string,
) => HueDtlsStream;

/**
 * Discovery function type. Tests can inject a mock.
 */
export type DiscoverFn = () => Promise<DiscoveredBridge[]>;

/**
 * Pairing function type. Tests can inject a mock.
 */
export type PairFn = (host: string) => Promise<PairingResult>;

// ---------------------------------------------------------------------------
// Internal state per bridge
// ---------------------------------------------------------------------------

interface BridgeState {
  config: HueBridgeConfig;
  client: HueClipClient;
  dtlsStream: HueDtlsStream | null;
  entities: Entity[];
  /** Map from entity ID to entertainment channel ID (for realtime lights) */
  entityToChannel: Map<string, number>;
  /** Set of light IDs that are part of an entertainment area */
  entertainmentLightIds: Set<string>;
  /** The entertainment config used, if any */
  entertainmentConfig: HueEntertainmentConfiguration | null;
  connected: boolean;
  streaming: boolean;
  lastUpdate: number;
}

// ---------------------------------------------------------------------------
// Rate limit declarations
// ---------------------------------------------------------------------------

const RATE_LIMITS: Record<string, RateLimitBudget> = {
  "realtime-light": {
    maxPerSecond: 6,
    defaultPerSecond: 6,
    description:
      "Entertainment streaming value change rate (bridge sends at 25Hz over ZigBee, visible effect rate <12.5Hz)",
  },
  light: {
    maxPerSecond: 10,
    defaultPerSecond: 10,
    description:
      "Individual light REST API updates (100ms gap, shared across all lights on bridge)",
  },
  group: {
    maxPerSecond: 1,
    defaultPerSecond: 1,
    description: "Group state changes via REST API",
  },
  scene: {
    maxPerSecond: 1,
    defaultPerSecond: 1,
    description: "Scene activations (group-level operation)",
  },
};

// ---------------------------------------------------------------------------
// Color conversion helpers
// ---------------------------------------------------------------------------

/**
 * Convert 16-bit RGB to CIE 1931 xy color space + brightness.
 * Uses the wide gamut sRGB -> XYZ conversion matrix.
 */
function rgb16ToXyBrightness(
  r: number,
  g: number,
  b: number,
): { x: number; y: number; bri: number } {
  // Normalize to 0-1
  const rNorm = r / 65535;
  const gNorm = g / 65535;
  const bNorm = b / 65535;

  // Apply reverse sRGB companding (gamma)
  const rLin = rNorm > 0.04045 ? Math.pow((rNorm + 0.055) / 1.055, 2.4) : rNorm / 12.92;
  const gLin = gNorm > 0.04045 ? Math.pow((gNorm + 0.055) / 1.055, 2.4) : gNorm / 12.92;
  const bLin = bNorm > 0.04045 ? Math.pow((bNorm + 0.055) / 1.055, 2.4) : bNorm / 12.92;

  // Convert to XYZ using Wide RGB D65 conversion matrix
  const X = rLin * 0.4124564 + gLin * 0.3575761 + bLin * 0.1804375;
  const Y = rLin * 0.2126729 + gLin * 0.7151522 + bLin * 0.072175;
  const Z = rLin * 0.0193339 + gLin * 0.119192 + bLin * 0.9503041;

  const sum = X + Y + Z;
  if (sum === 0) {
    return { x: 0.3127, y: 0.329, bri: 0 };
  }

  return {
    x: X / sum,
    y: Y / sum,
    bri: Math.min(100, Y * 100),
  };
}

// ---------------------------------------------------------------------------
// HueProtocolAdapter
// ---------------------------------------------------------------------------

export class HueProtocolAdapter implements ProtocolAdapter {
  readonly id = "hue";
  readonly name = "Philips Hue";
  readonly type = "hue";

  private readonly config: HueAdapterConfig;
  private readonly bridges = new Map<string, BridgeState>();

  private readonly createClipClient: CreateClipClient;
  private readonly createDtlsStream: CreateDtlsStream;
  private readonly discoverFn: DiscoverFn;
  private readonly pairFn: PairFn;

  constructor(
    config: HueAdapterConfig,
    deps?: {
      createClipClient?: CreateClipClient;
      createDtlsStream?: CreateDtlsStream;
      discoverFn?: DiscoverFn;
      pairFn?: PairFn;
    },
  ) {
    this.config = config;

    this.createClipClient =
      deps?.createClipClient ??
      ((host: string, username: string) => new HueClipClientImpl(host, username));

    this.createDtlsStream =
      deps?.createDtlsStream ??
      ((host: string, pskIdentity: string, clientKey: string, entertainmentConfigId: string) =>
        new HueDtlsStreamImpl(host, pskIdentity, clientKey, entertainmentConfigId));

    this.discoverFn = deps?.discoverFn ?? (() => discoverBridgesImpl());

    this.pairFn =
      deps?.pairFn ?? ((host: string) => pairWithBridgeImpl(host, "artnet-bridge", "default"));
  }

  // -----------------------------------------------------------------------
  // ProtocolAdapter — lifecycle
  // -----------------------------------------------------------------------

  async connect(): Promise<void> {
    for (const bridgeConfig of this.config.bridges) {
      const client = this.createClipClient(
        bridgeConfig.connection.host,
        bridgeConfig.connection.username,
      );

      const state: BridgeState = {
        config: bridgeConfig,
        client,
        dtlsStream: null,
        entities: [],
        entityToChannel: new Map(),
        entertainmentLightIds: new Set(),
        entertainmentConfig: null,
        connected: false,
        streaming: false,
        lastUpdate: 0,
      };

      // Fetch all resources
      const [lights, rooms, zones, groupedLights, scenes, entertainmentConfigs] = await Promise.all(
        [
          client.getLights(),
          client.getRooms(),
          client.getZones(),
          client.getGroupedLights(),
          client.getScenes(),
          client.getEntertainmentConfigurations(),
        ],
      );

      // Find the entertainment config if one is specified
      let activeEntConfig: HueEntertainmentConfiguration | null = null;
      if (bridgeConfig.entertainmentConfigId) {
        const found = entertainmentConfigs.find(
          (ec) => ec.id === bridgeConfig.entertainmentConfigId,
        );
        if (found) {
          activeEntConfig = found;
          state.entertainmentConfig = found;

          // Collect light IDs that are members of the entertainment area
          for (const channel of found.channels) {
            for (const member of channel.members) {
              state.entertainmentLightIds.add(member.service.rid);
            }
          }
        }
      }

      // Build entity list
      state.entities = this.buildEntities(
        bridgeConfig.id,
        lights,
        rooms,
        zones,
        groupedLights,
        scenes,
        activeEntConfig,
        state.entertainmentLightIds,
        state.entityToChannel,
      );

      // Start entertainment streaming if configured
      if (activeEntConfig) {
        const appId = await client.getApplicationId();
        await client.startEntertainment(activeEntConfig.id);

        const dtlsStream = this.createDtlsStream(
          bridgeConfig.connection.host,
          appId,
          bridgeConfig.connection.clientkey,
          activeEntConfig.id,
        );
        await dtlsStream.connect();
        state.dtlsStream = dtlsStream;
        state.streaming = true;
      }

      state.connected = true;
      this.bridges.set(bridgeConfig.id, state);
    }
  }

  async disconnect(): Promise<void> {
    for (const [, state] of this.bridges) {
      if (state.dtlsStream) {
        await state.dtlsStream.close();
        state.dtlsStream = null;
        state.streaming = false;
      }
      if (state.entertainmentConfig) {
        try {
          await state.client.stopEntertainment(state.entertainmentConfig.id);
        } catch {
          // Best-effort stop
        }
      }
      state.connected = false;
    }
    this.bridges.clear();
  }

  // -----------------------------------------------------------------------
  // ProtocolAdapter — discovery & pairing
  // -----------------------------------------------------------------------

  async discover(): Promise<DiscoveredBridge[]> {
    return this.discoverFn();
  }

  async pair(target: DiscoveredBridge): Promise<PairingResult> {
    return this.pairFn(target.host);
  }

  // -----------------------------------------------------------------------
  // ProtocolAdapter — entity access
  // -----------------------------------------------------------------------

  async getBridges(): Promise<ProtocolBridge[]> {
    const result: ProtocolBridge[] = [];
    for (const [, state] of this.bridges) {
      result.push({
        id: state.config.id,
        metadata: {
          name: state.config.name ?? state.config.id,
          host: state.config.connection.host,
        },
        entities: state.entities,
        rateLimits: { ...RATE_LIMITS },
      });
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // ProtocolAdapter — updates
  // -----------------------------------------------------------------------

  async handleRealtimeUpdate(bridgeId: string, updates: EntityUpdate[]): Promise<void> {
    const state = this.bridges.get(bridgeId);
    if (!state?.dtlsStream) {
      return;
    }

    const colorUpdates: ColorUpdate[] = [];
    for (const update of updates) {
      const channelId = state.entityToChannel.get(update.entityId);
      if (channelId === undefined) {
        continue;
      }
      if (update.value.type === "rgb") {
        colorUpdates.push({
          channelId,
          color: [update.value.r, update.value.g, update.value.b],
        });
      }
    }

    if (colorUpdates.length > 0) {
      state.dtlsStream.updateValues(colorUpdates);
      state.lastUpdate = Date.now();
    }
  }

  async handleLimitedUpdate(bridgeId: string, entityId: string, value: EntityValue): Promise<void> {
    const state = this.bridges.get(bridgeId);
    if (!state) {
      return;
    }

    const entity = state.entities.find((e) => e.id === entityId);
    if (!entity) {
      return;
    }

    switch (entity.category) {
      case "light": {
        if (value.type === "rgb") {
          const { x, y, bri } = rgb16ToXyBrightness(value.r, value.g, value.b);
          await state.client.setLightState(entityId, {
            color: { xy: { x, y } },
            dimming: { brightness: bri },
          });
        } else if (value.type === "rgb-dimmable") {
          const { x, y } = rgb16ToXyBrightness(value.r, value.g, value.b);
          const brightness = (value.dim / 65535) * 100;
          await state.client.setLightState(entityId, {
            color: { xy: { x, y } },
            dimming: { brightness },
          });
        }
        break;
      }
      case "group": {
        if (value.type === "brightness") {
          const brightness = (value.value / 65535) * 100;
          await state.client.setGroupedLightState(entityId, {
            dimming: { brightness },
          });
        } else if (value.type === "rgb") {
          const { x, y, bri } = rgb16ToXyBrightness(value.r, value.g, value.b);
          await state.client.setGroupedLightState(entityId, {
            color: { xy: { x, y } },
            dimming: { brightness: bri },
          });
        }
        break;
      }
      case "scene": {
        if (value.type === "scene-selector") {
          await state.client.activateScene(value.sceneId);
        }
        break;
      }
    }

    state.lastUpdate = Date.now();
  }

  // -----------------------------------------------------------------------
  // ProtocolAdapter — status
  // -----------------------------------------------------------------------

  getStatus(): AdapterStatus {
    const bridgeStatuses: Record<string, BridgeStatus> = {};
    for (const [id, state] of this.bridges) {
      bridgeStatuses[id] = {
        connected: state.connected,
        streaming: state.streaming,
        lastUpdate: state.lastUpdate || undefined,
        stats: {
          entities: state.entities.length,
          realtimeEntities: state.entities.filter((e) => e.controlMode === "realtime").length,
          limitedEntities: state.entities.filter((e) => e.controlMode === "limited").length,
        },
      };
    }
    return {
      connected: [...this.bridges.values()].some((s) => s.connected),
      bridges: bridgeStatuses,
    };
  }

  // -----------------------------------------------------------------------
  // ProtocolAdapter — web handlers
  // -----------------------------------------------------------------------

  registerWebHandlers(router: unknown): void {
    // Future: register Hue-specific routes under the provided router.
    // For now, this is a no-op placeholder.
    void router;
  }

  // -----------------------------------------------------------------------
  // Private — entity building
  // -----------------------------------------------------------------------

  private buildEntities(
    bridgeId: string,
    lights: HueLight[],
    rooms: HueRoom[],
    zones: HueZone[],
    groupedLights: HueGroupedLight[],
    scenes: HueScene[],
    entertainmentConfig: HueEntertainmentConfiguration | null,
    entertainmentLightIds: Set<string>,
    entityToChannel: Map<string, number>,
  ): Entity[] {
    const entities: Entity[] = [];

    // 1. Entertainment area lights (realtime)
    if (entertainmentConfig) {
      for (const channel of entertainmentConfig.channels) {
        for (const member of channel.members) {
          const light = lights.find((l) => l.id === member.service.rid);
          const entityId = member.service.rid;
          entityToChannel.set(entityId, channel.channel_id);
          entities.push({
            id: entityId,
            metadata: {
              name: light?.metadata.name ?? `Channel ${String(channel.channel_id)}`,
              type: "light",
              bridgeId,
              channelId: channel.channel_id,
            },
            controlMode: "realtime",
            category: "realtime-light",
            channelLayout: { type: "rgb" },
          });
        }
      }
    }

    // 2. Non-entertainment lights (limited)
    for (const light of lights) {
      if (entertainmentLightIds.has(light.id)) {
        continue;
      }
      entities.push({
        id: light.id,
        metadata: {
          name: light.metadata.name,
          type: "light",
          bridgeId,
        },
        controlMode: "limited",
        category: "light",
        channelLayout: { type: "rgb" },
      });
    }

    // 3. Groups (rooms + zones)
    const buildGroupEntity = (group: HueRoom | HueZone, groupType: string): void => {
      const groupedLight = group.services.find((s) => s.rtype === "grouped_light");
      if (!groupedLight) {
        return;
      }
      const gl = groupedLights.find((g) => g.id === groupedLight.rid);
      if (!gl) {
        return;
      }

      // Determine channel layout: check if any child is a color-capable light
      // For simplicity, assume rooms/zones with lights are brightness-controllable
      const layout: ChannelLayout = { type: "brightness" };

      entities.push({
        id: gl.id,
        metadata: {
          name: group.metadata.name,
          type: groupType,
          bridgeId,
          groupId: group.id,
        },
        controlMode: "limited",
        category: "group",
        channelLayout: layout,
      });

      // 4. Scene selectors per room/zone
      const groupScenes = scenes.filter((s) => s.group.rid === group.id);
      if (groupScenes.length > 0) {
        const sceneEntries: SceneEntry[] = groupScenes.map((s, idx) => ({
          index: idx + 1,
          sceneId: s.id,
          name: s.metadata.name,
        }));
        entities.push({
          id: `${group.id}-scenes`,
          metadata: {
            name: `${group.metadata.name} Scenes`,
            type: "scene-selector",
            bridgeId,
            groupId: group.id,
          },
          controlMode: "limited",
          category: "scene",
          channelLayout: { type: "scene-selector", scenes: sceneEntries },
        });
      }
    };

    for (const room of rooms) {
      buildGroupEntity(room, "room");
    }
    for (const zone of zones) {
      buildGroupEntity(zone, "zone");
    }

    return entities;
  }
}
