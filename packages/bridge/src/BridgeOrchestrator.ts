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

export interface EntityRuntimeStatus {
  lastValue?: EntityValue;
  lastUpdate?: number;
}

export interface BridgeRuntimeStatus {
  connected: boolean;
  streaming?: boolean;
  entityCount: number;
  realtimeCount: number;
  limitedCount: number;
  rateLimitUsage: Record<string, { current: number; max: number }>;
  entities: Record<string, EntityRuntimeStatus>;
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
  private readonly universeBuffers = new Map<number, Uint8Array>();

  private entityValues = new Map<string, { value: EntityValue; timestamp: number }>();

  private running = false;
  private frameCount = 0;
  private frameCounts: Record<number, number> = {};
  private lastFrameTime?: number;
  private seenUniverses = new Set<number>();

  // Poll watchdog
  private lastPollTime = 0;
  private pollLostLogged = false;
  private pollWatchdog?: ReturnType<typeof setInterval>;

  // Stats counters (reset each stats interval)
  private statsIntervalTimer?: ReturnType<typeof setInterval>;
  private statsFrameCount = 0;
  private statsFrameCounts: Record<number, number> = {};
  private statsRealtimeChanges: Record<string, number> = {};
  private statsLimitedDispatches: Record<string, Record<string, number>> = {};

  private readonly dmxHandler = (universe: number, data: Uint8Array): void => {
    this.handleDmx(universe, data);
  };

  private readonly statsIntervalSec: number;

  constructor(
    config: AppConfig,
    artnet: ArtNetReceiver,
    adapterFactories: Map<string, ProtocolAdapterFactory>,
    options?: { statsIntervalSec?: number },
  ) {
    this.config = config;
    this.artnet = artnet;
    this.adapterFactories = adapterFactories;
    this.statsIntervalSec = options?.statsIntervalSec ?? 10;
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
      console.log(`[Bridge] Connecting adapter: ${adapter.name}`);
      await adapter.connect();
      this.adapters.push(adapter);
    }

    // 2. Get protocol bridges and entities, build adapter lookup + entity index
    for (const adapter of this.adapters) {
      const bridges = await adapter.getBridges();
      let totalEntities = 0;
      for (const bridge of bridges) {
        this.adapterByBridgeId.set(bridge.id, adapter);
        for (const entity of bridge.entities) {
          this.entityIndex.set(`${bridge.id}:${entity.id}`, entity);
        }
        totalEntities += bridge.entities.length;
      }
      this.protocolBridges.push(...bridges);
      console.log(
        `[Bridge] Adapter ${adapter.name} connected (${bridges.length} bridges, ${totalEntities} entities)`,
      );
    }

    // 3. Build DmxMapper from config channel mappings + entities
    const mappings = this.buildMappings();
    this.dmxMapper = new DmxMapper(mappings);

    // 4. Create schedulers per bridge
    this.createSchedulers();

    // 5. Start ArtNet listener
    // Report configured universes in ArtPollReply so controllers see what we listen on
    const universes = [...new Set(this.config.bridges.map((b) => b.universe))];
    this.artnet.setOutputUniverses(universes);

    this.artnet.on("error", (err) => console.error("[ArtNet] Error:", err));
    const seenPollSources = new Set<string>();
    this.artnet.on("poll", (info: { address: string }) => {
      if (!seenPollSources.has(info.address)) {
        seenPollSources.add(info.address);
        console.log(`[ArtNet] Controller discovered: ${info.address}`);
      }
      this.lastPollTime = Date.now();
      this.pollLostLogged = false;
    });
    this.pollWatchdog = setInterval(() => {
      if (this.lastPollTime > 0 && Date.now() - this.lastPollTime > 10000 && !this.pollLostLogged) {
        console.log("[ArtNet] No polls received for 10s \u2014 controller may have disconnected");
        this.pollLostLogged = true;
      }
    }, 5000);
    this.artnet.on("dmx", this.dmxHandler);
    await this.artnet.start();
    console.log(
      `[ArtNet] Listening on ${this.config.artnet.bindAddress}:${this.config.artnet.port}`,
    );

    // 6. Start all schedulers
    for (const scheduler of this.realtimeSchedulers.values()) scheduler.start();
    for (const categoryMap of this.limitedSchedulers.values()) {
      for (const scheduler of categoryMap.values()) scheduler.start();
    }

    // 7. Start stats interval
    if (this.statsIntervalSec > 0) {
      this.statsIntervalTimer = setInterval(() => {
        this.logStats();
      }, this.statsIntervalSec * 1000);
    }

    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;

    // Stop timers
    if (this.statsIntervalTimer) {
      clearInterval(this.statsIntervalTimer);
      this.statsIntervalTimer = undefined;
    }
    if (this.pollWatchdog) {
      clearInterval(this.pollWatchdog);
      this.pollWatchdog = undefined;
    }

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
      console.error("[ArtNet] Stop error:", e);
    }

    // Disconnect adapters
    for (const adapter of this.adapters) {
      try {
        await adapter.disconnect();
        console.log(`[Bridge] Adapter ${adapter.name} disconnected`);
      } catch (e) {
        console.error(`[Bridge] Adapter ${adapter.id} disconnect error:`, e);
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
    this.entityValues.clear();
    this.universeBuffers.clear();
    this.seenUniverses.clear();
  }

  getAdapters(): ProtocolAdapter[] {
    return this.adapters;
  }

  /** Update entity value tracking (used by test controls to reflect test state in UI). */
  setEntityValue(bridgeId: string, entityId: string, value: EntityValue): void {
    this.entityValues.set(`${bridgeId}:${entityId}`, { value, timestamp: Date.now() });
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
      const elapsed = this.statsIntervalSec > 0 ? this.statsIntervalSec : 10;
      for (const [category, budget] of Object.entries(protocolBridge.rateLimits)) {
        const bridgeConfig = this.config.bridges.find((b) => b.id === protocolBridge.id);
        const userRate = bridgeConfig?.rateLimits?.[category];
        const configuredRate = Math.min(userRate ?? budget.defaultPerSecond, budget.maxPerSecond);

        // Actual dispatches per second from the current stats window
        let actualPerSec = 0;
        if (category === "realtime-light" || category === "realtime") {
          actualPerSec = Math.round(((this.statsRealtimeChanges[protocolBridge.id] ?? 0) / elapsed) * 10) / 10;
        } else {
          const catDispatches = this.statsLimitedDispatches[protocolBridge.id]?.[category] ?? 0;
          actualPerSec = Math.round((catDispatches / elapsed) * 10) / 10;
        }

        rateLimitUsage[category] = { current: actualPerSec, max: configuredRate };
      }

      const entityStatuses: Record<string, EntityRuntimeStatus> = {};
      for (const entity of protocolBridge.entities) {
        const tracked = this.entityValues.get(`${protocolBridge.id}:${entity.id}`);
        if (tracked) {
          entityStatuses[entity.id] = {
            lastValue: tracked.value,
            lastUpdate: tracked.timestamp,
          };
        }
      }

      bridges[protocolBridge.id] = {
        connected: bridgeStatus?.connected ?? false,
        streaming: bridgeStatus?.streaming,
        entityCount: protocolBridge.entities.length,
        realtimeCount,
        limitedCount,
        rateLimitUsage,
        entities: entityStatuses,
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
    this.statsFrameCount++;
    this.statsFrameCounts[universe] = (this.statsFrameCounts[universe] ?? 0) + 1;
    this.lastFrameTime = Date.now();

    // Log first time we see a universe — including first few channel values for debugging
    if (!this.seenUniverses.has(universe)) {
      this.seenUniverses.add(universe);
      console.log(`[ArtNet] First data on universe ${universe} (${data.length} bytes)`);
    }

    // Accumulate partial frames into a full 512-byte universe buffer
    let buffer = this.universeBuffers.get(universe);
    if (!buffer) {
      buffer = new Uint8Array(512);
      this.universeBuffers.set(universe, buffer);
    }
    // Copy received data into the buffer (partial frames update only the channels they contain)
    buffer.set(data.subarray(0, Math.min(data.length, 512)));

    // Extract values from the full buffer
    if (!this.dmxMapper) return;
    const values = this.dmxMapper.extractValues(universe, buffer);

    for (const { bridgeId, entityId, value } of values) {
      const entity = this.findEntity(bridgeId, entityId);
      if (!entity) continue;

      // Track live values for status reporting
      this.entityValues.set(`${bridgeId}:${entityId}`, { value, timestamp: Date.now() });

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
          new RealtimeScheduler(rate, async (updates: EntityUpdate[]) => {
            this.statsRealtimeChanges[capturedBridgeId] =
              (this.statsRealtimeChanges[capturedBridgeId] ?? 0) + updates.length;
            await capturedAdapter.handleRealtimeUpdate(capturedBridgeId, updates);
          }),
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
          new LimitedScheduler(rate, async (entityId: string, value: EntityValue) => {
            if (!this.statsLimitedDispatches[capturedBridgeId]) {
              this.statsLimitedDispatches[capturedBridgeId] = {};
            }
            this.statsLimitedDispatches[capturedBridgeId][category] =
              (this.statsLimitedDispatches[capturedBridgeId][category] ?? 0) + 1;
            await capturedAdapter.handleLimitedUpdate(capturedBridgeId, entityId, value);
          }),
        );
      }
      this.limitedSchedulers.set(protocolBridge.id, categoryMap);

      // Log scheduler creation
      const limitedCategories = [...categories];
      if (realtimeEntities.length > 0 || limitedCategories.length > 0) {
        const bridgeConfig = this.config.bridges.find((b) => b.id === protocolBridge.id);
        const realtimeRateLimit = protocolBridge.rateLimits["realtime-light"] ??
          protocolBridge.rateLimits["realtime"] ?? {
            defaultPerSecond: 6,
            maxPerSecond: 6,
          };
        const userRealtimeRate =
          bridgeConfig?.rateLimits?.["realtime-light"] ?? bridgeConfig?.rateLimits?.["realtime"];
        const realtimeRate = Math.min(
          userRealtimeRate ?? realtimeRateLimit.defaultPerSecond,
          realtimeRateLimit.maxPerSecond,
        );
        const parts: string[] = [];
        if (realtimeEntities.length > 0) parts.push(`realtime at ${realtimeRate}Hz`);
        if (limitedCategories.length > 0) parts.push(`limited: ${limitedCategories.join(", ")}`);
        console.log(`[Bridge] Scheduler created: ${protocolBridge.id} ${parts.join(", ")}`);
      }
    }
  }

  private logStats(): void {
    const parts: string[] = [];

    // ArtNet stats
    const universeList = Object.keys(this.statsFrameCounts)
      .map(Number)
      .sort((a, b) => a - b);
    const fps = Math.round(this.statsFrameCount / this.statsIntervalSec);
    parts.push(
      `ArtNet: ${this.statsFrameCount} frames (${fps}/s)${universeList.length > 0 ? ` on universes ${universeList.join(", ")}` : ""}`,
    );

    // Per-bridge stats
    for (const protocolBridge of this.protocolBridges) {
      const bridgeId = protocolBridge.id;
      const bridgeParts: string[] = [];

      const realtimeCount = this.statsRealtimeChanges[bridgeId] ?? 0;
      if (realtimeCount > 0) {
        bridgeParts.push(`${realtimeCount} realtime changes`);
      }

      const limitedCats = this.statsLimitedDispatches[bridgeId];
      if (limitedCats) {
        const totalLimited = Object.values(limitedCats).reduce((a, b) => a + b, 0);
        if (totalLimited > 0) {
          const catDetails = Object.entries(limitedCats)
            .map(([cat, count]) => `${count} ${cat}`)
            .join(", ");
          bridgeParts.push(`${totalLimited} limited dispatches (${catDetails})`);
        }
      }

      if (bridgeParts.length > 0) {
        const adapter = this.adapterByBridgeId.get(bridgeId);
        const label = adapter ? `${adapter.type} ${bridgeId}` : bridgeId;
        parts.push(`${label}: ${bridgeParts.join(", ")}`);
      }
    }

    console.log(`[Stats] ${parts.join(" | ")}`);

    // Reset counters
    this.statsFrameCount = 0;
    this.statsFrameCounts = {};
    this.statsRealtimeChanges = {};
    this.statsLimitedDispatches = {};
  }

  private findEntity(bridgeId: string, entityId: string): Entity | undefined {
    return this.entityIndex.get(`${bridgeId}:${entityId}`);
  }
}
