# ArtNet Bridge - Design Specification

## Overview

ArtNet Bridge maps ArtNet/DMX channels to IoT lighting protocols. The first protocol is Philips Hue (both Entertainment streaming and standard REST API), with extensibility for future protocols like Matter.

The system receives ArtNet DMX packets over UDP, maps channels to protocol-specific entities (lights, groups, scenes), and dispatches updates through protocol adapters with rate-limit-aware scheduling.

## Package Structure

npm workspaces monorepo. ESM-only. Node `>=22.13.0`.

```
packages/
  tools/              (not published, internal build tooling - copied from matter.js)
  artnet/             @artnet-bridge/artnet
  protocol/           @artnet-bridge/protocol
  protocol-hue/       @artnet-bridge/protocol-hue
  bridge/             artnet-bridge
```

### Dependency Graph (no cycles)

```
artnet-bridge (bridge/)
  +-- @artnet-bridge/artnet
  +-- @artnet-bridge/protocol
  +-- @artnet-bridge/protocol-hue
        +-- @artnet-bridge/protocol
        +-- node-dtls-client
```

### Tooling

Mirroring matterjs-server:

- **TypeScript** with `composite` project references, `tsc` for type-checking only, `esbuild` for transpilation
- **oxlint** for linting (with TypeScript plugin, type-aware)
- **oxfmt** for formatting
- **Rollup** for web UI bundling
- **Build orchestration** via `packages/tools` (matter-build CLI)
- **tsconfig hierarchy**: `tsconfig.base.json`, `tsconfig.lib.json`, `tsconfig.app.json`, `tsconfig.test.json` in `packages/tools/tsc/`

## Core Data Model

### Protocol Bridge

A protocol adapter exposes a two-dimensional structure: bridges containing entities.

```typescript
interface ProtocolBridge {
    id: string;
    metadata: BridgeMetadata;
    entities: Entity[];
    rateLimits: Record<string, RateLimitBudget>;
}

interface BridgeMetadata {
    name: string;
    host: string;
    [key: string]: unknown;
}
```

### Entity

Every controllable target (light, group, scene selector) is a flat `Entity`. The bridge core does not need to understand the semantic difference between them; it only cares about `controlMode`, `category` (for rate limit bucketing), and `channelLayout` (for DMX mapping).

```typescript
interface Entity {
    id: string;
    metadata: EntityMetadata;
    controlMode: "realtime" | "limited";
    category: string;
    channelLayout: ChannelLayout;
}

interface EntityMetadata {
    name: string;
    type: string;         // "light", "group", "room", "zone", "scene-selector"
    [key: string]: unknown;
}
```

### Channel Layout

Declares what DMX channels an entity consumes. Defined by the protocol adapter per entity.

```typescript
type ChannelLayout =
    | { type: "rgb" }              // 3 or 6 channels depending on mode (8bit/16bit)
    | { type: "rgb-dimmable" }     // 4 channels (Dim, R, G, B) in 8bit mode
    | { type: "scene-selector"; scenes: SceneEntry[] }  // 1 channel, maps 1-255 to scene list
    | { type: "brightness" }       // 1 channel, 8bit (for group brightness control)

interface SceneEntry {
    index: number;        // DMX value (1-255) that triggers this scene
    sceneId: string;      // protocol-specific scene identifier
    name: string;         // display name for UI
}
```

The user-configured `DmxChannelMapping.channelMode` must be compatible with the entity's `channelLayout.type`. For example, an entity with `{ type: "rgb" }` accepts `channelMode: "8bit"` or `"16bit"`. An entity with `{ type: "scene-selector" }` only accepts `channelMode: "scene-selector"`.

### Entity Values

Values passed from the bridge core to protocol adapters. All color values are normalized to 16-bit (0-65535) by the bridge's DMX Mapper, regardless of the source channel mode (8bit, 8bit-dimmable, 16bit). Protocol adapters always receive consistent value types.

```typescript
type EntityValue =
    | { type: "rgb"; r: number; g: number; b: number }             // RGB, each 0-65535
    | { type: "rgb-dimmable"; dim: number; r: number; g: number; b: number } // DRGB, each 0-65535
    | { type: "scene-selector"; sceneId: string }                  // scene activation
    | { type: "brightness"; value: number }                        // 0-65535

interface EntityUpdate {
    entityId: string;
    value: EntityValue;
}
```

**Value normalization** (performed by bridge core's DMX Mapper):
- `8bit` mode: each byte multiplied by 257 to scale 0-255 → 0-65535
- `8bit-dimmable` mode: dimmer and RGB each scaled to 0-65535
- `16bit` mode: coarse/fine bytes combined as `(coarse << 8) | fine`, already 0-65535
- `scene-selector` mode: DMX value looked up in `SceneEntry[]` list, passed as `{ type: "scene", sceneId }`. Value 0 = no action (skip). Value exceeding scene list length = no action.

### Discovery and Pairing Types

```typescript
interface DiscoveredBridge {
    id: string;
    host: string;
    name?: string;
    protocol: string;
    metadata: Record<string, unknown>;  // protocol-specific (model, firmware, etc.)
}

interface PairingResult {
    success: boolean;
    connection?: Record<string, unknown>;  // stored in BridgeConfig.connection
    error?: string;
}

interface AdapterStatus {
    connected: boolean;
    bridges: Record<string, BridgeStatus>;
}

interface BridgeStatus {
    connected: boolean;
    streaming?: boolean;             // for entertainment/realtime bridges
    lastUpdate?: number;             // timestamp
    stats: Record<string, number>;   // protocol-specific counters
}
```

- `controlMode: "realtime"` — entity is updated via continuous streaming (e.g., Hue Entertainment DTLS). The bridge buffers values; the protocol adapter handles actual transmission rate.
- `controlMode: "limited"` — entity is updated via individual API calls with a shared rate budget per category per bridge.

### Rate Limits

Rate limits are per bridge, per category. The budget is shared across all entities in that category on that bridge.

```typescript
interface RateLimitBudget {
    maxPerSecond: number;       // hard limit — cannot be exceeded
    defaultPerSecond: number;   // used when user has not configured an override
    description: string;        // shown in config/UI as informational text
}
```

For Hue, the adapter declares (per Hue API guidelines: ~10 commands/sec to `/lights` with 100ms gap, max 1/sec to `/groups`):
- `"light"`: max 10/sec shared across all limited lights on a bridge (100ms gap between calls)
- `"group"`: max 1/sec shared across all groups on a bridge
- `"scene"`: max 1/sec shared across all scene activations on a bridge (scene activation is a group-level operation internally)
- Realtime lights report ~6Hz as their rate limit (half of the Hue-recommended 12.5Hz max visible effect rate)

Users can configure limits between 0 and the declared max. Effective limits are shown in the config/UI as informational values.

### DMX Channel Mapping

```typescript
interface DmxChannelMapping {
    targetId: string;
    targetType: string;         // metadata, e.g. "light", "group"
    dmxStart: number;           // 1-512
    channelMode: ChannelMode;   // "8bit" | "8bit-dimmable" | "16bit" | "scene-selector" | "brightness"
}
```

`dmxEnd` is derived at runtime from `dmxStart + channelWidth(channelMode) - 1` and not persisted.

Channel width by mode:
- `8bit`: 3 channels (R, G, B)
- `8bit-dimmable`: 4 channels (Dim, R, G, B)
- `16bit`: 6 channels (R-coarse, R-fine, G-coarse, G-fine, B-coarse, B-fine)
- `scene-selector`: 1 channel (value 0 = no action, 1-255 maps to entity's `SceneEntry[]` list; values beyond list length = no action)
- `brightness`: 1 channel (0-255, scaled to 0-65535 for group brightness control)

Validation: computed `dmxEnd` must not exceed 512. No overlapping ranges within the same universe (validated globally across all bridges on that universe). Validated at config save time and at startup.

ArtNet universes use 0-based numbering in the protocol. `BridgeConfig.universe` uses 0-based indexing to match. The web UI may display as 1-based for user convenience with a note.

## Rate-Limited Dispatch

The bridge core owns all rate limiting. Two strategies based on control mode.

### Realtime Dispatch

Uses a `Set<entityId>` for dirty tracking and a `Map<entityId, value>` for latest values.

```
On DMX change for entity X:
  valueMap.set(X, newValue)
  dirtySet.add(X)

On rate limit tick (~6Hz for Hue realtime):
  collect all dirty entity IDs
  send batch of (entityId, value) pairs to protocol adapter
  dirtySet.clear()
```

The protocol adapter (e.g., Hue) maintains its own continuous transmission loop (50Hz for Hue Entertainment) using the latest values from its internal buffer. The bridge controls the rate of *value change*; the adapter controls the rate of *transmission*.

### Limited Dispatch

Uses a `Set<entityId>` as an insertion-ordered queue and a `Map<entityId, value>` for latest values.

**Critical constraint:** Each API call must complete (response received or timed out) before the next one is dispatched. The rate limit tick only fires the next call if the previous one has finished. This prevents overwhelming a slow or overloaded bridge — the rate limit is a *maximum*, not a guaranteed throughput.

```
On DMX change for entity X:
  valueMap.set(X, newValue)
  if X not in dirtySet: dirtySet.add(X)   // appended at end

On rate limit tick:
  if previousCallStillPending: skip this tick
  entityId = dirtySet.values().next()      // first = most stale
  dirtySet.delete(entityId)
  send valueMap.get(entityId) to protocol adapter
  await response (or timeout)
  mark as ready for next tick
```

This provides fair round-robin distribution of the shared budget. With 20 lights and 10 req/sec, each light averages ~0.5 updates/sec in worst case (all changing simultaneously). If a bridge responds slowly, effective throughput drops naturally — we never stack up concurrent requests. Entities whose values haven't changed are not in the dirty set and consume no budget.

All operations are O(1). Note: JavaScript `Set` guarantees insertion order per the ECMAScript specification, which makes this pattern reliable.

## Protocol Adapter Interface

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

    /** Optional: register protocol-specific web routes (e.g., Hue pairing UI, protocol-specific config pages) */
    registerWebHandlers?(router: Express.Router): void;
}
```

- `handleRealtimeUpdate` receives a batch of dirty entities on each realtime tick.
- `handleLimitedUpdate` receives a single entity update per rate limit tick.

**Adapter lifecycle:** `discover()` and `pair()` are stateless operations usable before any connection. `connect()` uses credentials already stored in `BridgeConfig.connection` (from a prior `pair()` call). Sequence: discover → pair → save credentials to config → connect.

## Package Details

### `@artnet-bridge/artnet`

Own ArtNet protocol implementation based on the Art-Net specification (PDF included in repo at `docs/art-net.pdf`). Zero external dependencies (only `node:dgram`).

**Supported opcodes:**
- `OpOutput` (0x5000) — DMX data reception
- `OpPoll` (0x2000) — discovery poll (respond so ArtNet controllers see us)
- `OpPollReply` (0x2100) — reply to polls

**Exports:**
```typescript
class ArtNetReceiver {
    constructor(options?: { bindAddress?: string; port?: number });
    start(): Promise<void>;
    stop(): Promise<void>;
    on(event: "dmx", handler: (universe: number, data: Uint8Array) => void): void;
    on(event: "poll", handler: (info: PollInfo) => void): void;
}

class ArtNetSender {
    constructor(options?: { targetAddress?: string; port?: number });
    sendDmx(universe: number, data: Uint8Array): void;
    close(): void;
}
```

`ArtNetSender` serves dual purpose: test simulator and usable export for external consumers.

**Testing:** Unit tests for packet parsing/serialization, integration tests via sender-receiver roundtrip on localhost UDP.

The Art-Net spec PDF must be analyzed during implementation to ensure full compliance with packet formats, version fields, and poll/reply behavior.

### `@artnet-bridge/protocol`

Base types and interfaces shared by the bridge and all protocol adapters. No runtime dependencies.

Contains:
- `ProtocolAdapter` interface
- `ProtocolBridge`, `Entity`, `EntityMetadata`, `BridgeMetadata` types
- `RateLimitBudget` type
- `DmxChannelMapping` and `ChannelMode` types
- `EntityUpdate`, `EntityValue` types
- `DiscoveredBridge`, `PairingResult`, `AdapterStatus` types
- `ChannelLayout` definitions

### `@artnet-bridge/protocol-hue`

Implements `ProtocolAdapter` for Philips Hue.

**Internal components:**
- `HueProtocolAdapter` — main adapter class, implements the protocol interface
- `HueClipClient` — thin Hue CLIP v2 REST client using native `fetch`. HTTPS with self-signed cert handling for local bridges.
- `HueDtlsStream` — DTLS streaming via `node-dtls-client`. Sends continuously at ~50Hz. PSK with `TLS_PSK_WITH_AES_128_GCM_SHA256` cipher suite. UDP port 2100.
- `HueDiscovery` — mDNS + `discovery.meethue.com` fallback
- `HuePairing` — link-button pairing flow, returns username + clientKey

**Hue CLIP v2 endpoints used:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/clip/v2/resource/light` | GET | List lights |
| `/clip/v2/resource/light/{id}` | PUT | Set light state |
| `/clip/v2/resource/room` | GET | List rooms |
| `/clip/v2/resource/zone` | GET | List zones |
| `/clip/v2/resource/grouped_light` | GET | List grouped lights |
| `/clip/v2/resource/grouped_light/{id}` | PUT | Set group state |
| `/clip/v2/resource/scene` | GET | List scenes |
| `/clip/v2/resource/scene/{id}` | PUT | Activate scene |
| `/clip/v2/resource/entertainment_configuration` | GET | List entertainment areas |
| `/clip/v2/resource/entertainment_configuration/{id}` | PUT | Start/stop streaming |
| `/api` | POST | Create app user (pairing) |
| `/auth/v1` | GET | Get hue-application-id for DTLS PSK identity (verify against reference implementation during development) |

**Entertainment streaming behavior:**
- Continuous packet transmission at ~50Hz (20ms interval), per Hue best practices
- Always sends current state, even when values haven't changed (UDP loss compensation)
- Bridge decimates to 25Hz over ZigBee
- Visible effect rate should be <12.5Hz; adapter reports ~6Hz to bridge as rate limit for realtime entities
- One entertainment area per bridge (Hue hardware limit)
- Max 10 lights per entertainment area (Hue hardware limit)
- Lights in the active entertainment area are auto-excluded from REST control and reported as `controlMode: "realtime"`

**Entertainment packet format (v2):** Refer to `docs/HueEntertainmentAPI.html` for the authoritative byte layout. Summary: `HueStream` header (16 bytes, including protocol version 0x02/0x00 and color space byte 0x00 for RGB) + entertainment configuration UUID (36 bytes, ASCII) + per-channel color data (7 bytes each: 1 byte channel ID + 3x 2 byte RGB16 big-endian). Target protocol version is v2.

### `artnet-bridge` (bridge/)

Main application package. Orchestrates everything.

**Components:**
- **Config Manager** — load/save/validate JSON config with file locking (`~/.artnet-bridge/config.lock` with PID). Migration support for future schema versions.
- **ArtNet Listener** — instantiates `ArtNetReceiver`, dispatches frames to mapped bridges.
- **DMX Mapper** — extracts channel values per entity per bridge from raw DMX data.
- **Rate Limit Scheduler** — realtime and limited dispatch strategies (see Rate-Limited Dispatch section above).
- **Protocol Loader** — instantiates and manages protocol adapters.
- **Web Server** — Express-based (modeled after matterjs-server), serves static UI + REST API + WebSocket.
- **CLI** — minimal entry point with `--config`, `--port`, `--no-web` flags. Optional config subcommands for one-time operations (discover, pair).

## Configuration

### File Location

Default: `~/.artnet-bridge/config.json`
Override: `--config <path>`
Lock file: `~/.artnet-bridge/config.lock` (PID-based, prevents concurrent writes from server + CLI)

### Schema

```typescript
interface AppConfig {
    version: number;
    artnet: {
        bindAddress: string;    // default "0.0.0.0"
        port: number;           // default 6454
    };
    web: {
        port: number;           // default 8080
        enabled: boolean;       // default true
    };
    bridges: BridgeConfig[];
}

interface BridgeConfig {
    id: string;
    name?: string;
    protocol: string;                            // "hue"
    connection: Record<string, unknown>;          // protocol-specific (host, credentials)
    universe: number;                            // ArtNet universe
    channelMappings: DmxChannelMapping[];
    rateLimits?: Record<string, number>;         // user overrides (validated against hard limits)
    protocolConfig?: Record<string, unknown>;     // protocol-specific (e.g. entertainment area ID)
}
```

## Web UI

### Server

- Express-based HTTP server (blueprint from matterjs-server web server)
- Handler/router approach for extensibility
- Protocol adapters can register custom web handlers via `registerWebHandlers()` — mounted under `/protocol/<type>/` (e.g., `/protocol/hue/`). This allows protocol-specific UI pages (e.g., Hue pairing flow, entertainment area configuration, protocol-specific diagnostics).
- Static file serving for bundled frontend
- REST API for config CRUD, bridge discovery, pairing
- WebSocket for live status push

### Frontend

- Vanilla JS/HTML/CSS, bundled with Rollup
- Dark theme

### Default View (compact)

Compact overview showing:
- All bridges with connection status
- Entity count per bridge (realtime vs limited)
- ArtNet frame rate per universe
- Per-bridge link to protocol-specific pages (if adapter registered web handlers)
- No live per-entity data by default

### Detail Panel (toggled per bridge)

User clicks to expand a bridge. Only then does the client subscribe via WebSocket:
- Per-entity: current RGB/state, last update timestamp, control mode badge ("realtime" / "limited")
- Rate limit budget usage per category (e.g., "lights: 8/10 req/s used")
- DTLS streaming stats for realtime bridges
- Debug test controls: solid color buttons (bypass ArtNet for testing)

### WebSocket Protocol

```
Client → Server: { "type": "subscribe", "bridgeId": "bridge-1" }
Client → Server: { "type": "unsubscribe", "bridgeId": "bridge-1" }
Server → Client: { "type": "status", "bridgeId": "bridge-1", "data": { ... } }
Server → Client: { "type": "artnet", "data": { ... } }
```

All messages carry a `type` discriminator for extensibility. Server only sends data for subscribed bridges. No data pushed when no subscriptions are active.

## CLI

### Primary Usage

```bash
artnet-bridge                           # start server (ArtNet + bridges + web UI)
artnet-bridge --config /path/config.json   # custom config path
artnet-bridge --port 9090               # custom web UI port
artnet-bridge --no-web                  # headless (no web UI)
```

### Config CLI (optional, for one-time operations)

```bash
artnet-bridge config discover           # discover bridges on network
artnet-bridge config pair <host>        # pair with a bridge (link button flow)
```

File locking ensures the config CLI and running server don't write simultaneously.

## Error Handling & Reconnection

### ArtNet Receiver
- Bind failure (port in use): log error, exit with clear message. Do not silently fall back to another port.
- Malformed packets: silently discard. Log at debug level only (ArtNet networks can be noisy).

### DTLS Streaming (Hue Entertainment)
- Connection drop: auto-reconnect with exponential backoff (1s, 2s, 4s, max 30s). Log each attempt.
- Handshake failure: log error, mark bridge as disconnected in status. Retry on backoff schedule.
- During reconnection: buffer latest values. Recovery requires re-activating the entertainment configuration via REST PUT, then re-establishing the DTLS handshake. Resume streaming immediately once both steps succeed.
- Entertainment area already claimed by another app: log warning, mark as unavailable. Retry periodically (e.g., every 30s).

### Hue REST API
- HTTP errors (4xx/5xx): log and skip the update. Do not retry immediately (rate budget continues to tick).
- 429 (rate limited by bridge): log warning. The bridge's own rate limiting should prevent this, but if it occurs, back off for 1 second on that category.
- Bridge unreachable: mark as disconnected, retry connection on backoff schedule.
- Self-signed certificate errors: handled by disabling certificate validation for local bridge connections (Hue bridges use private CA).

### Configuration
- Config file missing: create with defaults on first run.
- Config file corrupt/unparseable: log error, refuse to start. Do not silently overwrite.
- Schema migration: backup old config to `config.backup.json` before migrating.
- Lock file stale (PID no longer running): clean up and proceed.

### General Principle
Protocol adapters report errors to the bridge core via status updates. The bridge core reflects these in the web UI. No silent failures — every error state is visible in the status dashboard.

## Testing Strategy

### `@artnet-bridge/artnet`
- **Unit tests:** Packet parsing and serialization for all supported opcodes. Edge cases: malformed packets, truncated data, maximum universe number.
- **Integration tests:** `ArtNetSender` → `ArtNetReceiver` roundtrip on localhost UDP. Multi-universe filtering. Poll/reply exchange.
- **Simulator:** `ArtNetSender` is also the test simulator — usable for manual testing and CI.

### `@artnet-bridge/protocol`
- **Unit tests:** Type validation helpers (if any). Channel width calculation. DMX address range validation.
- Mostly type definitions; minimal runtime logic to test.

### `@artnet-bridge/protocol-hue`
- **Unit tests:** Hue CLIP v2 client with mocked HTTP responses (mock `fetch`). DTLS packet construction. Discovery response parsing. DMX-to-Hue color conversion.
- **Integration tests:** Where possible, test against a recorded set of Hue API responses. DTLS streaming tested with a mock UDP server that validates packet format.

### `artnet-bridge`
- **Unit tests:** DMX Mapper (value extraction and normalization). Rate limit scheduler (dirty set behavior, round-robin fairness). Config validation and migration.
- **Integration tests:** Full pipeline with ArtNet simulator → bridge → mock protocol adapter. WebSocket subscribe/unsubscribe behavior.

### General
- Test framework: to be aligned with matterjs-server (mocha-based via `@matter/testing` or equivalent).
- CI runs all tests on Node 22.x and 24.x.

## GitHub Actions

Mirroring matterjs-server, minus Docker, Python client, and matterjs nightly validation.

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `build-test.yml` | Push/PR to main | Lint (oxlint), format check (oxfmt), build (multi-platform), tests |
| `nightly-dev-release.yml` | Daily 02:30 UTC + manual | Auto-create prerelease PR if code changed |
| `official-release.yml` | Manual dispatch | Create PR for semver release |
| `release-npm.yml` | PR labeled `automated-npm-release` | Test, auto-merge, publish to npm, create GitHub release |
| `auto-approve-release.yml` | Release PR from bot | Auto-approve release PRs |

Shared action: `.github/actions/prepare-env/` (setup Node 22, `npm ci`)

Test matrix: Node 22.x + 24.x on ubuntu-latest. Build verification on macOS + Windows.

## External Dependencies

Kept minimal:

| Package | Used By | Purpose |
|---------|---------|---------|
| `node-dtls-client` | protocol-hue | DTLS 1.2 streaming to Hue Entertainment API |
| `express` | bridge | Web server |

Everything else uses Node.js built-ins: `node:dgram` (ArtNet UDP), `node:http` (underlying server), `node:crypto`, native `fetch` (Hue REST API), native WebSocket (Node 22).

## Documentation

### Root README.md

Project overview, quick start guide (install, first run, pair a bridge, map channels), and links to detailed docs.

### docs/ folder

- `docs/cli.md` — CLI usage: all flags, config subcommands, examples
- `docs/configuration.md` — config file format, all options, rate limit configuration, validation rules
- `docs/web-ui.md` — web UI usage, WebSocket protocol, how to enable detail panels
- `docs/developing-protocols.md` — how to create a new protocol adapter (the `ProtocolAdapter` interface, web handler registration, rate limit declaration)

### Package-specific READMEs

Each package has its own `README.md` linked from the root docs:

- `packages/artnet/README.md` — ArtNet protocol details, `ArtNetReceiver` and `ArtNetSender` API, simulator usage
- `packages/protocol/README.md` — base types, how to implement `ProtocolAdapter`, entity model
- `packages/protocol-hue/README.md` — **Hue-specific documentation:**
  - How Hue bridge discovery and pairing works
  - Two control modes explained: Entertainment (realtime DTLS streaming at 50Hz, max 10 lights/bridge, <12.5Hz visible effect rate) vs Standard REST API (rate-limited, lights/groups/scenes)
  - How entertainment area selection works and auto-exclusion of realtime lights from REST
  - Rate limit details per resource type (lights: 10/sec, groups: 1/sec, scenes: 1/sec)
  - Channel modes: 8bit RGB, 8bit-dimmable, 16bit, scene-selector, brightness
  - Configuration examples for common setups
  - Hue API CLIP v2 endpoints used
- `packages/bridge/README.md` — main application architecture, how protocol adapters are loaded, config management

## Reference Materials

- Art-Net specification: `docs/art-net.pdf` (to be analyzed during ArtNet package implementation)
- Hue Entertainment API: `docs/HueEntertainmentAPI.html` (saved from Hue developer portal)
- Reference projects (checked out locally):
  - `artnet-hue-entertainment` — entertainment streaming reference
  - `dmx-hue` — standard API reference
  - `node-hue-api` — Hue client library (v5 beta, TypeScript, comprehensive API coverage)
- matterjs-server — tooling and CI reference at `/Users/ingof/DevOHF/matterjs-server`
