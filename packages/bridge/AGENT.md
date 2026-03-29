# Bridge Package -- Agent Context

This is the main application package. It contains the orchestrator, schedulers, DMX mapper, config management, CLI, and web UI.

## Key files

| File | Purpose |
|------|---------|
| `src/cli.ts` | CLI entry point, argument parsing, adapter factory registration, config subcommands |
| `src/BridgeOrchestrator.ts` | Core orchestration: connects adapters, builds mappings, creates schedulers, handles DMX frames |
| `src/dmx/DmxMapper.ts` | Extracts entity values from DMX frames based on channel mappings |
| `src/scheduler/RealtimeScheduler.ts` | Dirty-set batching for entertainment streaming |
| `src/scheduler/LimitedScheduler.ts` | FIFO round-robin for REST API rate limiting |
| `src/config/ConfigSchema.ts` | `AppConfig` and `BridgeConfig` types, validation, defaults |
| `src/config/ConfigManager.ts` | Load/save config with locking and migration |
| `src/config/ConfigLock.ts` | PID-based file locking for concurrent access |
| `src/web/WebServer.ts` | Express 5 + WebSocket server setup |
| `src/web/WebSocketHandler.ts` | WebSocket message handling (subscribe/unsubscribe for live status) |
| `src/web/routes/configRoutes.ts` | Config REST API routes |
| `src/web/routes/statusRoutes.ts` | Status REST API routes |
| `src/web/routes/bridgeRoutes.ts` | Bridge discovery, pairing, resources, test routes |
| `src/web/public/app.js` | Vanilla JS web UI (no framework) |
| `src/web/public/app.css` | Web UI styles |
| `src/web/public/index.html` | Web UI HTML shell |

## Orchestrator startup sequence

`BridgeOrchestrator.start()` executes these steps in order:

1. **Create and connect adapters** -- iterate `config.bridges`, find factory, call `adapter.connect()`
2. **Get bridges and entities** -- call `adapter.getBridges()`, build `adapterByBridgeId` map and `entityIndex`
3. **Build mappings** -- match config `channelMappings` to protocol entities via `targetId`
4. **Create schedulers** -- one `RealtimeScheduler` per bridge, one `LimitedScheduler` per bridge per category
5. **Set output universes and start ArtNet** -- configure PollReply, attach `dmx` handler, call `artnet.start()`
6. **Start all schedulers**
7. **Start stats interval** (configurable via `--stats-interval`)

## Shutdown

`BridgeOrchestrator.stop()` must be resilient. Each step is wrapped in try/catch:
1. Stop timers (stats, poll watchdog)
2. Stop schedulers
3. Remove ArtNet listener, stop ArtNet
4. Disconnect adapters (each in individual try/catch)
5. Clear all state maps

## DMX dispatch flow

```
ArtNet UDP frame
  --> universeBuffers[universe].set(data)  (partial frame accumulation)
  --> DmxMapper.extractValues(universe, buffer)
  --> for each { bridgeId, entityId, value }:
      --> entity.controlMode === "realtime"?
          --> RealtimeScheduler.update(entityId, value)
      --> entity.controlMode === "limited"?
          --> LimitedScheduler.update(entityId, value)
```

Schedulers then dispatch on their tick interval:
- RealtimeScheduler: batches all dirty entities into one `handleRealtimeUpdate()` call
- LimitedScheduler: dispatches one entity per tick via `handleLimitedUpdate()`

## Rate limit dispatch

`LimitedScheduler` creates one instance per bridge per category. Budget is shared across all entities in that category on that bridge. Rate is resolved from: user override (config `rateLimits`) clamped to `maxPerSecond` from the adapter's `RateLimitBudget`.

## Config schema

Defined in `src/config/ConfigSchema.ts`:

```typescript
interface AppConfig {
  version: number;          // Currently 1
  artnet: { bindAddress: string; port: number };
  web: { port: number; enabled: boolean };
  bridges: BridgeConfig[];
}

interface BridgeConfig {
  id: string;
  name?: string;
  protocol: string;
  connection: Record<string, unknown>;
  universe: number;         // 0-based ArtNet universe
  channelMappings: DmxChannelMapping[];
  rateLimits?: Record<string, number>;   // User overrides
  protocolConfig?: Record<string, unknown>;
}
```

**Important**: Channel mappings use `targetId` (the entity ID), NOT `entityId`. The `DmxChannelMapping` interface:
```typescript
interface DmxChannelMapping {
  targetId: string;
  targetType: string;
  dmxStart: number;       // 1-512
  channelMode: ChannelMode;
}
```

Config location: `~/.artnet-bridge/config.json`. Locking via PID file (`config.lock`).

## Web UI

Vanilla JS in `src/web/public/`. No framework, no bundler.

Anti-patterns to avoid:
- NEVER use `innerHTML` -- use `document.createElement()` and `textContent`
- The file uses `@ts-nocheck` and `/* eslint-disable */` because it is plain JS, not TypeScript

WebSocket protocol: JSON messages with a `type` discriminator:
- Client sends: `{ type: "subscribe", bridgeId: "..." }` or `{ type: "unsubscribe", bridgeId: "..." }`
- Server sends: `{ type: "status", data: RuntimeStatus }` on interval

## Stats logging

Every N seconds (configurable via `--stats-interval`, default 10). Counters reset each interval. Logs ArtNet frame counts per universe and per-bridge realtime changes / limited dispatches.

## Tests

| Test file | What it covers |
|-----------|---------------|
| `test/BridgeOrchestratorTest.ts` | Orchestrator lifecycle, DMX dispatch |
| `test/dmx/DmxMapperTest.ts` | DMX value extraction for all channel modes |
| `test/scheduler/RealtimeSchedulerTest.ts` | Dirty-set batching, dedup |
| `test/scheduler/LimitedSchedulerTest.ts` | FIFO dispatch, await-before-next |
| `test/web/WebServerTest.ts` | HTTP routes |
| `test/web/WebSocketHandlerTest.ts` | WebSocket subscribe/unsubscribe |
| `test/config/ConfigManagerTest.ts` | Config load/save/validation |
| `test/cli/CliTest.ts` | CLI argument parsing, config subcommands |
| `test/integration/EndToEndTest.ts` | Full pipeline: ArtNet --> orchestrator --> adapter |
