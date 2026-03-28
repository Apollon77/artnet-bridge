# @artnet-bridge/protocol

Base types and interfaces shared by the bridge core and all protocol adapters. No runtime dependencies.

## Contents

This package defines the contract between the bridge and protocol adapters:

- `ProtocolAdapter` -- interface all adapters implement
- `ProtocolBridge`, `Entity`, `BridgeMetadata`, `EntityMetadata` -- bridge/entity model
- `ChannelLayout`, `ChannelMode`, `SceneEntry` -- DMX channel definitions
- `EntityValue`, `EntityUpdate` -- normalized values passed to adapters
- `DmxChannelMapping` -- DMX-to-entity mapping configuration
- `RateLimitBudget` -- rate limit declarations
- `DiscoveredBridge`, `PairingResult`, `AdapterStatus`, `BridgeStatus` -- discovery and status types

## Implementing ProtocolAdapter

See the full guide at [Developing Protocol Adapters](../../docs/developing-protocols.md).

The key interface:

```typescript
interface ProtocolAdapter {
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
  registerWebHandlers?(router: unknown): void;
}
```

## Entity Model

```
ProtocolBridge
  +-- metadata: { name, host }
  +-- rateLimits: { "light": { maxPerSecond, defaultPerSecond, description } }
  +-- entities[]
        +-- id
        +-- metadata: { name, type }
        +-- controlMode: "realtime" | "limited"
        +-- category: string (rate limit bucket)
        +-- channelLayout: ChannelLayout
```

Control modes:
- `"realtime"` -- continuous streaming (e.g., DTLS). Bridge batches dirty values.
- `"limited"` -- individual API calls with shared rate budget per category.

## Value Normalization

All values are normalized to 16-bit (0-65535) by the bridge core before reaching adapters:

| Source Mode | Normalization |
|-------------|--------------|
| `8bit` | byte * 257 (0-255 to 0-65535) |
| `8bit-dimmable` | each channel * 257 |
| `16bit` | `(coarse << 8) \| fine` (already 0-65535) |
| `scene-selector` | DMX value looked up in scene list |
| `brightness` | byte * 257 |

## Channel Width Utility

```typescript
import { channelWidth } from "@artnet-bridge/protocol";

channelWidth("8bit");           // 3
channelWidth("8bit-dimmable");  // 4
channelWidth("16bit");          // 6
channelWidth("scene-selector"); // 1
channelWidth("brightness");     // 1
```

## Mapping Validation

```typescript
import { validateMappings } from "@artnet-bridge/protocol";

const errors = validateMappings(mappings);
// Returns string[] of error messages. Empty = valid.
// Checks: bounds (1-512), dmxEnd <= 512, no overlaps.
```
