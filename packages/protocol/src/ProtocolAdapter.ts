import type { DiscoveredBridge, PairingResult, ProtocolBridge, AdapterStatus } from "./types.js";
import type { EntityUpdate, EntityValue } from "./EntityValue.js";

/**
 * Interface that all protocol adapters must implement.
 */
export interface ProtocolAdapter {
    readonly id: string;
    readonly name: string;
    readonly type: string;

    connect(): Promise<void>;
    disconnect(): Promise<void>;

    discover(): Promise<DiscoveredBridge[]>;
    pair(target: DiscoveredBridge): Promise<PairingResult>;

    getBridges(): Promise<ProtocolBridge[]>;

    handleRealtimeUpdate(bridgeId: string, updates: EntityUpdate[]): Promise<void>;
    handleLimitedUpdate(bridgeId: string, entityId: string, value: EntityValue): Promise<void>;

    getStatus(): AdapterStatus;

    /**
     * Optional: register protocol-specific web routes.
     * Routes are mounted under /protocol/<type>/
     */
    registerWebHandlers?(router: unknown): void;
}
