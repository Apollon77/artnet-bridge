import type { ChannelLayout } from "./ChannelLayout.js";
import type { RateLimitBudget } from "./RateLimit.js";

export interface EntityMetadata {
    name: string;
    /** e.g., "light", "group", "room", "zone", "scene-selector" */
    type: string;
    [key: string]: unknown;
}

export interface Entity {
    id: string;
    metadata: EntityMetadata;
    controlMode: "realtime" | "limited";
    /** Rate limit bucket category, e.g., "light", "group", "scene" */
    category: string;
    channelLayout: ChannelLayout;
}

export interface BridgeMetadata {
    name: string;
    host: string;
    [key: string]: unknown;
}

export interface ProtocolBridge {
    id: string;
    metadata: BridgeMetadata;
    entities: Entity[];
    rateLimits: Record<string, RateLimitBudget>;
}

export interface DiscoveredBridge {
    id: string;
    host: string;
    name?: string;
    protocol: string;
    metadata: Record<string, unknown>;
}

export interface PairingResult {
    success: boolean;
    connection?: Record<string, unknown>;
    error?: string;
}

export interface BridgeStatus {
    connected: boolean;
    streaming?: boolean;
    lastUpdate?: number;
    stats: Record<string, number>;
}

export interface AdapterStatus {
    connected: boolean;
    bridges: Record<string, BridgeStatus>;
}
