import { ArtNetReceiver } from "@artnet-bridge/artnet";
import type {
  ProtocolAdapter,
  ProtocolBridge,
  Entity,
  EntityUpdate,
  EntityValue,
  DmxChannelMapping,
} from "@artnet-bridge/protocol";
import type { AppConfig, BridgeConfig } from "./config/ConfigSchema.js";
import { DmxMapper } from "./dmx/DmxMapper.js";
import { RealtimeScheduler } from "./scheduler/RealtimeScheduler.js";
import { LimitedScheduler } from "./scheduler/LimitedScheduler.js";

export interface RuntimeStatus {
  artnet: {
    running: boolean;
    frameCount: number;
    frameCounts: Record<number, number>;
    lastFrameTime?: number;
  };
  bridges: Record<string, BridgeRuntimeStatus>;
}

export interface BridgeRuntimeStatus {
  connected: boolean;
  streaming?: boolean;
  entityCount: number;
  realtimeCount: number;
  limitedCount: number;
  rateLimitUsage: Record<string, { current: number; max: number }>;
}

export interface ProtocolAdapterFactory {
  (bridgeConfig: BridgeConfig): ProtocolAdapter;
}

export class BridgeOrchestrator {
  private readonly config: AppConfig;
  private readonly artnet: ArtNetReceiver;
  private readonly adapterFactories: Map<string, ProtocolAdapterFactory>;

  private adapters: ProtocolAdapter[] = [];
  private adapterByBridgeId = new Map<string, ProtocolAdapter>();
  private protocolBridges: ProtocolBridge[] = [];
  private entityIndex = new Map<string, Entity>();
  private dmxMapper?: DmxMapper;
  private realtimeSchedulers = new Map<string, RealtimeScheduler>();
  private limitedSchedulers = new Map<string, Map<string, LimitedScheduler>>();

  private running = false;
  private frameCount = 0;
  private frameCounts: Record<number, number> = {};
  private lastFrameTime?: number;

  private readonly dmxHandler = (universe: number, data: Uint8Array): void => {
    this.handleDmx(universe, data);
  };

  constructor(
    config: AppConfig,
    artnet: ArtNetReceiver,
    adapterFactories: Map<string, ProtocolAdapterFactory>,
  ) {
    this.config = config;
    this.artnet = artnet;
    this.adapterFactories = adapterFactories;
  }

  async start(): Promise<void> {
    // 1. Create and connect adapters
    for (const bridgeConfig of this.config.bridges) {
      const factory = this.adapterFactories.get(bridgeConfig.protocol);
      if (!factory) {
        console.error(`No adapter factory for protocol: ${bridgeConfig.protocol}`);
        continue;
      }
      const adapter = factory(bridgeConfig);
      await adapter.connect();
      this.adapters.push(adapter);
    }

    // 2. Get protocol bridges and entities, build adapter lookup + entity index
    for (const adapter of this.adapters) {
      const bridges = await adapter.getBridges();
      for (const bridge of bridges) {
        this.adapterByBridgeId.set(bridge.id, adapter);
        for (const entity of bridge.entities) {
          this.entityIndex.set(`${bridge.id}:${entity.id}`, entity);
        }
      }
      this.protocolBridges.push(...bridges);
    }

    // 3. Build DmxMapper from config channel mappings + entities
    const mappings = this.buildMappings();
    this.dmxMapper = new DmxMapper(mappings);

    // 4. Create schedulers per bridge
    this.createSchedulers();

    // 5. Start ArtNet listener
    this.artnet.on("error", (err) => console.error("ArtNet error:", err));
    this.artnet.on("dmx", this.dmxHandler);
    await this.artnet.start();

    // 6. Start all schedulers
    for (const scheduler of this.realtimeSchedulers.values()) scheduler.start();
    for (const categoryMap of this.limitedSchedulers.values()) {
      for (const scheduler of categoryMap.values()) scheduler.start();
    }

    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;

    // Stop schedulers
    for (const scheduler of this.realtimeSchedulers.values()) scheduler.stop();
    for (const categoryMap of this.limitedSchedulers.values()) {
      for (const scheduler of categoryMap.values()) scheduler.stop();
    }

    // Remove listener and stop ArtNet
    this.artnet.off("dmx", this.dmxHandler);
    try {
      await this.artnet.stop();
    } catch (e) {
      console.error("ArtNet stop error:", e);
    }

    // Disconnect adapters
    for (const adapter of this.adapters) {
      try {
        await adapter.disconnect();
      } catch (e) {
        console.error(`Adapter ${adapter.id} disconnect error:`, e);
      }
    }

    // Clear state
    this.adapters = [];
    this.adapterByBridgeId.clear();
    this.protocolBridges = [];
    this.entityIndex.clear();
    this.dmxMapper = undefined;
    this.realtimeSchedulers.clear();
    this.limitedSchedulers.clear();
  }

  getAdapters(): ProtocolAdapter[] {
    return this.adapters;
  }

  getStatus(): RuntimeStatus {
    const bridges: Record<string, BridgeRuntimeStatus> = {};

    for (const protocolBridge of this.protocolBridges) {
      const adapter = this.adapterByBridgeId.get(protocolBridge.id);
      const adapterStatus = adapter?.getStatus();
      const bridgeStatus = adapterStatus?.bridges[protocolBridge.id];

      const realtimeCount = protocolBridge.entities.filter(
        (e) => e.controlMode === "realtime",
      ).length;
      const limitedCount = protocolBridge.entities.filter(
        (e) => e.controlMode === "limited",
      ).length;

      const rateLimitUsage: Record<string, { current: number; max: number }> = {};
      for (const [category, budget] of Object.entries(protocolBridge.rateLimits)) {
        const bridgeConfig = this.config.bridges.find((b) => b.id === protocolBridge.id);
        const userRate = bridgeConfig?.rateLimits?.[category];
        const effectiveRate = Math.min(userRate ?? budget.defaultPerSecond, budget.maxPerSecond);
        rateLimitUsage[category] = { current: effectiveRate, max: budget.maxPerSecond };
      }

      bridges[protocolBridge.id] = {
        connected: bridgeStatus?.connected ?? false,
        streaming: bridgeStatus?.streaming,
        entityCount: protocolBridge.entities.length,
        realtimeCount,
        limitedCount,
        rateLimitUsage,
      };
    }

    return {
      artnet: {
        running: this.running,
        frameCount: this.frameCount,
        frameCounts: { ...this.frameCounts },
        lastFrameTime: this.lastFrameTime,
      },
      bridges,
    };
  }

  private handleDmx(universe: number, data: Uint8Array): void {
    this.frameCount++;
    this.frameCounts[universe] = (this.frameCounts[universe] ?? 0) + 1;
    this.lastFrameTime = Date.now();

    if (!this.dmxMapper) return;
    const values = this.dmxMapper.extractValues(universe, data);

    for (const { bridgeId, entityId, value } of values) {
      const entity = this.findEntity(bridgeId, entityId);
      if (!entity) continue;

      if (entity.controlMode === "realtime") {
        const scheduler = this.realtimeSchedulers.get(bridgeId);
        scheduler?.update(entityId, value);
      } else {
        const categoryMap = this.limitedSchedulers.get(bridgeId);
        const scheduler = categoryMap?.get(entity.category);
        scheduler?.update(entityId, value);
      }
    }
  }

  private buildMappings(): Array<{
    bridgeId: string;
    universe: number;
    entity: Entity;
    mapping: DmxChannelMapping;
  }> {
    const result: Array<{
      bridgeId: string;
      universe: number;
      entity: Entity;
      mapping: DmxChannelMapping;
    }> = [];

    for (const bridgeConfig of this.config.bridges) {
      // Find the protocol bridge that matches this config
      const protocolBridge = this.protocolBridges.find((b) => b.id === bridgeConfig.id);
      if (!protocolBridge) continue;

      for (const mapping of bridgeConfig.channelMappings) {
        // Find the entity referenced by the mapping
        const entity = protocolBridge.entities.find((e) => e.id === mapping.targetId);
        if (!entity) continue;

        result.push({
          bridgeId: bridgeConfig.id,
          universe: bridgeConfig.universe,
          entity,
          mapping,
        });
      }
    }

    return result;
  }

  private createSchedulers(): void {
    for (const protocolBridge of this.protocolBridges) {
      const adapter = this.adapterByBridgeId.get(protocolBridge.id);
      if (!adapter) continue;

      // One RealtimeScheduler per bridge
      const realtimeEntities = protocolBridge.entities.filter((e) => e.controlMode === "realtime");
      if (realtimeEntities.length > 0) {
        const rateLimit = protocolBridge.rateLimits["realtime-light"] ??
          protocolBridge.rateLimits["realtime"] ?? {
            defaultPerSecond: 6,
            maxPerSecond: 6,
            description: "",
          };

        const bridgeConfig = this.config.bridges.find((b) => b.id === protocolBridge.id);
        const userRate =
          bridgeConfig?.rateLimits?.["realtime-light"] ?? bridgeConfig?.rateLimits?.["realtime"];
        const rate = Math.min(userRate ?? rateLimit.defaultPerSecond, rateLimit.maxPerSecond);

        const capturedAdapter = adapter;
        const capturedBridgeId = protocolBridge.id;
        this.realtimeSchedulers.set(
          protocolBridge.id,
          new RealtimeScheduler(rate, (updates: EntityUpdate[]) =>
            capturedAdapter.handleRealtimeUpdate(capturedBridgeId, updates),
          ),
        );
      }

      // One LimitedScheduler per bridge per category
      const categoryMap = new Map<string, LimitedScheduler>();
      const categories = new Set(
        protocolBridge.entities.filter((e) => e.controlMode === "limited").map((e) => e.category),
      );
      for (const category of categories) {
        const rateLimit = protocolBridge.rateLimits[category] ?? {
          defaultPerSecond: 1,
          maxPerSecond: 1,
          description: "",
        };

        const bridgeConfig = this.config.bridges.find((b) => b.id === protocolBridge.id);
        const userRate = bridgeConfig?.rateLimits?.[category];
        const rate = Math.min(userRate ?? rateLimit.defaultPerSecond, rateLimit.maxPerSecond);

        const capturedAdapter = adapter;
        const capturedBridgeId = protocolBridge.id;
        categoryMap.set(
          category,
          new LimitedScheduler(rate, (entityId: string, value: EntityValue) =>
            capturedAdapter.handleLimitedUpdate(capturedBridgeId, entityId, value),
          ),
        );
      }
      this.limitedSchedulers.set(protocolBridge.id, categoryMap);
    }
  }

  private findEntity(bridgeId: string, entityId: string): Entity | undefined {
    return this.entityIndex.get(`${bridgeId}:${entityId}`);
  }
}
