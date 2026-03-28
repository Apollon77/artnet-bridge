import type { DmxChannelMapping } from "@artnet-bridge/protocol";
import { validateMappings } from "@artnet-bridge/protocol";

export interface AppConfig {
  version: number;
  artnet: {
    bindAddress: string;
    port: number;
  };
  web: {
    port: number;
    enabled: boolean;
  };
  bridges: BridgeConfig[];
}

export interface BridgeConfig {
  id: string;
  name?: string;
  protocol: string;
  connection: Record<string, unknown>;
  universe: number; // 0-based
  channelMappings: DmxChannelMapping[];
  rateLimits?: Record<string, number>; // user overrides
  protocolConfig?: Record<string, unknown>;
}

export const CURRENT_CONFIG_VERSION = 1;

export const DEFAULT_CONFIG: AppConfig = {
  version: CURRENT_CONFIG_VERSION,
  artnet: {
    bindAddress: "0.0.0.0",
    port: 6454,
  },
  web: {
    port: 8080,
    enabled: true,
  },
  bridges: [],
};

/** Validate config. Returns array of error messages (empty = valid). */
export function validateConfig(config: AppConfig): string[] {
  const errors: string[] = [];

  // Validate version
  if (config.version !== CURRENT_CONFIG_VERSION) {
    errors.push(`Unknown config version: ${config.version}`);
  }

  // Validate bridges
  for (const bridge of config.bridges) {
    if (!bridge.id) errors.push("Bridge missing id");
    if (!bridge.protocol) errors.push(`Bridge ${bridge.id}: missing protocol`);
    if (bridge.universe < 0) errors.push(`Bridge ${bridge.id}: universe must be >= 0`);

    // Validate channel mappings
    const mappingErrors = validateMappings(bridge.channelMappings);
    for (const err of mappingErrors) {
      errors.push(`Bridge ${bridge.id}: ${err}`);
    }
  }

  // Validate cross-bridge: no overlapping mappings on same universe
  const universeMap = new Map<number, DmxChannelMapping[]>();
  for (const bridge of config.bridges) {
    const existing = universeMap.get(bridge.universe) ?? [];
    existing.push(...bridge.channelMappings);
    universeMap.set(bridge.universe, existing);
  }
  for (const [universe, mappings] of universeMap) {
    const overlapErrors = validateMappings(mappings);
    for (const err of overlapErrors) {
      // Only report overlap errors (bounds already reported per-bridge)
      if (err.includes("overlap")) {
        errors.push(`Universe ${universe}: ${err}`);
      }
    }
  }

  return errors;
}
