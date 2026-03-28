import type {
  DmxChannelMapping,
  EntityValue,
  Entity,
  ChannelLayout,
} from "@artnet-bridge/protocol";
import { channelWidth } from "@artnet-bridge/protocol";

interface MappedEntity {
  bridgeId: string;
  entityId: string;
  mapping: DmxChannelMapping;
  entity: Entity;
}

export interface ExtractedValue {
  bridgeId: string;
  entityId: string;
  value: EntityValue;
}

export class DmxMapper {
  /** Key: universe number -> list of mapped entities on that universe */
  private readonly universeMap: Map<number, MappedEntity[]>;

  constructor(
    bridgeMappings: Array<{
      bridgeId: string;
      universe: number;
      entity: Entity;
      mapping: DmxChannelMapping;
    }>,
  ) {
    this.universeMap = new Map();
    for (const m of bridgeMappings) {
      const list = this.universeMap.get(m.universe) ?? [];
      list.push({
        bridgeId: m.bridgeId,
        entityId: m.entity.id,
        mapping: m.mapping,
        entity: m.entity,
      });
      this.universeMap.set(m.universe, list);
    }
  }

  /**
   * Extract entity values from a DMX frame.
   * Returns only entities mapped to this universe.
   */
  extractValues(universe: number, data: Uint8Array): ExtractedValue[] {
    const mapped = this.universeMap.get(universe);
    if (!mapped) return [];

    const results: ExtractedValue[] = [];
    for (const m of mapped) {
      const value = extractEntityValue(m.mapping, m.entity, data);
      if (value !== undefined) {
        results.push({ bridgeId: m.bridgeId, entityId: m.entityId, value });
      }
    }
    return results;
  }
}

function extractEntityValue(
  mapping: DmxChannelMapping,
  entity: Entity,
  data: Uint8Array,
): EntityValue | undefined {
  const start = mapping.dmxStart - 1; // convert 1-based to 0-based index
  const width = channelWidth(mapping.channelMode);

  // Bounds check
  if (start + width > data.length) return undefined;

  switch (mapping.channelMode) {
    case "8bit": {
      // 3 channels: R, G, B -- each scaled by 257 to 0-65535
      const r = data[start] * 257;
      const g = data[start + 1] * 257;
      const b = data[start + 2] * 257;
      return { type: "rgb", r, g, b };
    }
    case "8bit-dimmable": {
      // 4 channels: Dim, R, G, B -- each scaled to 0-65535
      const dim = data[start] * 257;
      const r = data[start + 1] * 257;
      const g = data[start + 2] * 257;
      const b = data[start + 3] * 257;
      return { type: "rgb-dimmable", dim, r, g, b };
    }
    case "16bit": {
      // 6 channels: R-coarse, R-fine, G-coarse, G-fine, B-coarse, B-fine
      const r = (data[start] << 8) | data[start + 1];
      const g = (data[start + 2] << 8) | data[start + 3];
      const b = (data[start + 4] << 8) | data[start + 5];
      return { type: "rgb", r, g, b };
    }
    case "scene-selector": {
      const dmxValue = data[start];
      if (dmxValue === 0) return undefined; // no action
      const layout: ChannelLayout = entity.channelLayout;
      if (layout.type !== "scene-selector") return undefined;
      const scene = layout.scenes.find((s) => s.index === dmxValue);
      if (!scene) return undefined; // DMX value doesn't match any scene
      return { type: "scene-selector", sceneId: scene.sceneId };
    }
    case "brightness": {
      // 1 channel: 0-255 scaled to 0-65535
      const value = data[start] * 257;
      return { type: "brightness", value };
    }
  }
}
