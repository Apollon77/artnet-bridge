# Protocol Package -- Agent Context

This package contains the base types and interfaces shared by all protocol adapters and the bridge core. It has no runtime dependencies.

## Key files

| File | Purpose |
|------|---------|
| `src/types.ts` | `Entity`, `ProtocolBridge`, `DiscoveredBridge`, `PairingResult`, `AdapterStatus` |
| `src/ProtocolAdapter.ts` | `ProtocolAdapter` interface -- all adapters must implement this |
| `src/EntityValue.ts` | `EntityValue` discriminated union, `EntityUpdate` |
| `src/ChannelLayout.ts` | `ChannelLayout` discriminated union, `ChannelMode`, `channelWidth()` |
| `src/DmxMapping.ts` | `DmxChannelMapping`, `computeDmxEnd()`, `validateMappings()` |
| `src/RateLimit.ts` | `RateLimitBudget` interface |
| `src/deepEqual.ts` | `isDeepEqual()` -- deep equality for plain objects/primitives |
| `src/index.ts` | Re-exports everything |

## Current EntityValue types

```typescript
type EntityValue =
  | { type: "rgb"; r: number; g: number; b: number }           // 3 channels, values 0-65535
  | { type: "rgb-dimmable"; dim: number; r: number; g: number; b: number }  // 4 channels
  | { type: "scene-selector"; sceneId: string }                 // 1 channel
  | { type: "brightness"; value: number };                      // 1 channel, value 0-65535
```

## Current ChannelLayout types

```typescript
type ChannelLayout =
  | { type: "rgb" }
  | { type: "rgb-dimmable" }
  | { type: "scene-selector"; scenes: SceneEntry[] }
  | { type: "brightness" };
```

## Current ChannelMode values

```typescript
type ChannelMode = "8bit" | "8bit-dimmable" | "16bit" | "scene-selector" | "brightness";
```

Channel widths: `8bit`=3, `8bit-dimmable`=4, `16bit`=6, `scene-selector`=1, `brightness`=1.

## Adding a new EntityValue type

All locations that must be updated (this is a cross-cutting concern):

1. **`packages/protocol/src/EntityValue.ts`** -- add variant to `EntityValue` union
2. **`packages/protocol/src/ChannelLayout.ts`** -- add variant to `ChannelLayout` union if needed, add case to `channelWidth()` if new mode
3. **`packages/bridge/src/dmx/DmxMapper.ts`** -- add case in `extractEntityValue()` switch for the new channel mode
4. **`packages/protocol-hue/src/HueProtocolAdapter.ts`**:
   - `handleRealtimeUpdate()` -- handle the new value type for entertainment streaming
   - `applyColorState()` -- handle the new value type for REST dispatch
5. **`packages/bridge/src/web/public/app.js`**:
   - `entityValueToRgb()` -- convert new value type to `[r8, g8, b8]` for UI display
   - `mappingCompatibleModes()` -- map new layout type to compatible channel modes
6. **`packages/bridge/src/web/routes/bridgeRoutes.ts`** -- update test route if the new type affects test color dispatch

## Adding a new ChannelMode

1. **`packages/protocol/src/ChannelLayout.ts`** -- add to `ChannelMode` union, add case to `channelWidth()`
2. **`packages/bridge/src/dmx/DmxMapper.ts`** -- add extraction case in `extractEntityValue()` switch
3. **`packages/bridge/src/web/public/app.js`** -- add to `mappingCompatibleModes()` for applicable layout types
4. Update QLC+ fixture definition if maintaining one

## isDeepEqual

Use `isDeepEqual` (not `JSON.stringify`) for comparing `EntityValue` objects. It is used by both `RealtimeScheduler` and `LimitedScheduler` for deduplication.

```typescript
import { isDeepEqual } from "@artnet-bridge/protocol";

if (isDeepEqual(oldValue, newValue)) {
  // skip -- no change
}
```
