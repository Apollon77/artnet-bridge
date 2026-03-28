# Developing Protocol Adapters

This guide explains how to create a new protocol adapter for ArtNet Bridge.

## The ProtocolAdapter Interface

Every protocol adapter implements this interface from `@artnet-bridge/protocol`:

```typescript
interface ProtocolAdapter {
  readonly id: string;       // e.g., "matter"
  readonly name: string;     // e.g., "Matter Protocol"
  readonly type: string;     // e.g., "matter"

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  discover(): Promise<DiscoveredBridge[]>;
  pair(target: DiscoveredBridge): Promise<PairingResult>;

  getBridges(): Promise<ProtocolBridge[]>;

  handleRealtimeUpdate(bridgeId: string, updates: EntityUpdate[]): Promise<void>;
  handleLimitedUpdate(bridgeId: string, entityId: string, value: EntityValue): Promise<void>;

  getStatus(): AdapterStatus;

  // Optional: register protocol-specific web routes
  registerWebHandlers?(router: unknown): void;
}
```

## Adapter Lifecycle

1. **Discovery** -- `discover()` scans the network for compatible devices. Stateless, no connection required.
2. **Pairing** -- `pair(target)` establishes trust with a discovered device. Returns credentials stored in `BridgeConfig.connection`.
3. **Connection** -- `connect()` uses stored credentials to connect. Called at startup for configured bridges.
4. **Operation** -- the bridge core calls `handleRealtimeUpdate` and `handleLimitedUpdate` as DMX values change.
5. **Shutdown** -- `disconnect()` cleans up connections.

## Entity Model

Each adapter exposes a two-level structure: bridges containing entities.

### ProtocolBridge

```typescript
interface ProtocolBridge {
  id: string;
  metadata: BridgeMetadata;    // { name, host, ... }
  entities: Entity[];
  rateLimits: Record<string, RateLimitBudget>;
}
```

### Entity

```typescript
interface Entity {
  id: string;
  metadata: EntityMetadata;    // { name, type, ... }
  controlMode: "realtime" | "limited";
  category: string;            // rate limit bucket ("light", "group", etc.)
  channelLayout: ChannelLayout;
}
```

- `controlMode: "realtime"` -- entity is updated via continuous streaming. The bridge batches dirty values and calls `handleRealtimeUpdate` at the declared rate.
- `controlMode: "limited"` -- entity is updated via individual API calls. The bridge calls `handleLimitedUpdate` one entity at a time, respecting the rate budget.
- `category` -- groups entities that share a rate limit budget. All "light" entities on one bridge share the "light" budget.

### Channel Layouts

The `channelLayout` tells the bridge how many DMX channels this entity needs:

| Layout | Description | Compatible Modes |
|--------|-------------|------------------|
| `{ type: "rgb" }` | Color light | `8bit` (3ch), `16bit` (6ch) |
| `{ type: "rgb-dimmable" }` | Color light with dimmer | `8bit-dimmable` (4ch) |
| `{ type: "scene-selector", scenes: [...] }` | Scene trigger | `scene-selector` (1ch) |
| `{ type: "brightness" }` | Brightness only | `brightness` (1ch) |

## Rate Limit Declaration

Declare rate limits per category in each `ProtocolBridge`:

```typescript
rateLimits: {
  "light": {
    maxPerSecond: 10,
    defaultPerSecond: 10,
    description: "Individual light API calls"
  },
  "group": {
    maxPerSecond: 1,
    defaultPerSecond: 1,
    description: "Group state changes"
  }
}
```

The bridge core enforces these limits. Users can reduce rates (down to 0) but not exceed the declared maximum.

## Value Normalization

All values arrive normalized to 16-bit (0-65535), regardless of the source DMX channel mode:

```typescript
type EntityValue =
  | { type: "rgb"; r: number; g: number; b: number }
  | { type: "rgb-dimmable"; dim: number; r: number; g: number; b: number }
  | { type: "scene-selector"; sceneId: string }
  | { type: "brightness"; value: number };
```

Your adapter does not need to handle 8-bit vs 16-bit conversion. The bridge core does that.

## Web Handler Registration

Adapters can optionally register protocol-specific web routes:

```typescript
registerWebHandlers(router: unknown): void {
  // Routes are mounted under /protocol/<type>/
  // e.g., /protocol/matter/status
  const r = router as Express.Router;
  r.get("/status", (req, res) => { ... });
  r.post("/pair", (req, res) => { ... });
}
```

This is useful for protocol-specific UI pages (pairing flows, diagnostics, etc.).

## Example Skeleton

```typescript
import type {
  ProtocolAdapter,
  ProtocolBridge,
  DiscoveredBridge,
  PairingResult,
  AdapterStatus,
  EntityUpdate,
  EntityValue,
} from "@artnet-bridge/protocol";

export class MyProtocolAdapter implements ProtocolAdapter {
  readonly id = "my-protocol";
  readonly name = "My Protocol";
  readonly type = "my-protocol";

  async connect(): Promise<void> {
    // Connect to configured bridges using stored credentials
  }

  async disconnect(): Promise<void> {
    // Clean up connections
  }

  async discover(): Promise<DiscoveredBridge[]> {
    // Scan network for compatible devices
    return [];
  }

  async pair(target: DiscoveredBridge): Promise<PairingResult> {
    // Establish trust, return credentials
    return { success: true, connection: { host: target.host, token: "..." } };
  }

  async getBridges(): Promise<ProtocolBridge[]> {
    // Return bridge structure with entities and rate limits
    return [];
  }

  async handleRealtimeUpdate(bridgeId: string, updates: EntityUpdate[]): Promise<void> {
    // Apply batched realtime updates (streaming)
  }

  async handleLimitedUpdate(bridgeId: string, entityId: string, value: EntityValue): Promise<void> {
    // Apply single rate-limited update (API call)
  }

  getStatus(): AdapterStatus {
    return { connected: false, bridges: {} };
  }
}
```

## Package Setup

Create a new package under `packages/protocol-<name>/` following the monorepo conventions:

1. Add `@artnet-bridge/protocol` as a dependency
2. Export your adapter class from `src/index.ts`
3. Register the adapter factory in `packages/bridge/src/cli.ts`
4. Add the workspace to the root `package.json`

See `packages/protocol-hue/` for a complete reference implementation.
