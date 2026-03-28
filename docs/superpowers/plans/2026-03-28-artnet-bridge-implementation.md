# ArtNet Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an ArtNet/DMX bridge to IoT lighting protocols, starting with Philips Hue (Entertainment streaming + Standard REST API).

**Architecture:** npm workspaces monorepo with 5 packages: `tools` (build tooling), `artnet` (ArtNet protocol), `protocol` (base types), `protocol-hue` (Hue adapter), `bridge` (main app with web UI). Protocol adapters expose bridges containing entities; the bridge core handles rate-limited dispatch via dirty-set scheduling.

**Tech Stack:** TypeScript, ESM-only, Node >=22.13.0, esbuild + tsc, oxlint + oxfmt, Express, node-dtls-client, Rollup (web UI), native fetch/WebSocket.

**Spec:** `docs/superpowers/specs/2026-03-28-artnet-bridge-design.md`

**Reference projects:**
- `/Users/ingof/Dev/GitHub/artnet-hue-entertainment` — Entertainment streaming reference
- `/Users/ingof/Dev/GitHub/dmx-hue` — Standard Hue API reference
- `/Users/ingof/Dev/GitHub/node-hue-api` — Hue client library (API surface reference)
- `/Users/ingof/DevOHF/matterjs-server` — Tooling, CI, project structure reference

---

## Phase 1: Project Scaffolding & Build Tooling

### Task 1: Initialize monorepo root

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.oxlintrc.json`

- [ ] **Step 1: Create root package.json**

Model after `/Users/ingof/DevOHF/matterjs-server/main-matterjs-server/package.json`. Key changes:
- `name`: `"artnet-bridge-monorepo"`
- `private`: true
- `type`: `"module"`
- `workspaces`: `["packages/tools", "packages/artnet", "packages/protocol", "packages/protocol-hue", "packages/bridge"]`
- `engines.node`: `">=22.13.0"`
- `scripts`: same pattern (clean, build-only, build, build-clean, lint, lint-fix, format, format-verify, test, version)
- `devDependencies`: `typescript`, `oxlint`, `oxfmt`, `tsx`, `@types/mocha`, `glob`, `globals`
- Remove all matter.js specific deps (`@matter/testing`, etc.)
- `repository.url`: `"git+https://github.com/Apollon77/artnet-bridge.git"`
- `homepage`: `"https://github.com/Apollon77/artnet-bridge"`
- `bugs.url`: `"https://github.com/Apollon77/artnet-bridge/issues"`
- `author`: `"Ingo Fischer"`
- `license`: `"MIT"`

- [ ] **Step 2: Create root tsconfig.json**

```json
{
    "files": [],
    "references": [
        { "path": "packages/tools" },
        { "path": "packages/artnet" },
        { "path": "packages/protocol" },
        { "path": "packages/protocol-hue" },
        { "path": "packages/bridge" }
    ]
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
build/
dist/
/.*
!/.gitignore
!/.oxlintrc.json
!/.github
```

- [ ] **Step 4: Create .oxlintrc.json**

Copy from `/Users/ingof/DevOHF/matterjs-server/main-matterjs-server/.oxlintrc.json`. Adjust `ignorePatterns` to remove matter.js specific paths. Keep TypeScript and import plugins, all rules.

- [ ] **Step 5: Verify git status is clean and sensible**

Run: `git status`
Expected: New files shown as untracked.

- [ ] **Step 6: Add files to git (do not commit)**

Run: `git add package.json tsconfig.json .gitignore .oxlintrc.json`

---

### Task 2: Copy and adapt packages/tools

**Files:**
- Create: `packages/tools/` (entire directory, copied from matterjs-server)

- [ ] **Step 1: Copy the tools package**

Copy entire `packages/tools/` directory from `/Users/ingof/DevOHF/matterjs-server/main-matterjs-server/packages/tools/` to `packages/tools/`.

- [ ] **Step 2: Adapt packages/tools/package.json**

Change:
- `name`: `"@artnet-bridge/tools"`
- `private`: true (keep as internal)
- `repository.url`: point to artnet-bridge repo
- `homepage`/`bugs`: point to artnet-bridge repo
- `author`: `"Ingo Fischer"`
- `license`: `"MIT"`
- Keep all dependencies as-is (esbuild, typescript, commander, etc.)
- Update `engines.node` to `">=22.13.0"`

- [ ] **Step 3: Update bin script names**

In `packages/tools/package.json`, rename bin entries:
- `"matter-build"` → `"artnet-build"`
- `"matter-run"` → `"artnet-run"`
- `"matter-version"` → `"artnet-version"`
- `"matter-embed-examples"` → remove (not needed)

Search through `packages/tools/src/` for references to `matter-build`, `matter-run`, `matter-test`, `matter-version` and update to `artnet-*` equivalents.

- [ ] **Step 4: Remove matter.js specific code**

Remove `packages/tools/bin/prepare-chip.js`, `packages/tools/bin/embed-examples.js`, `packages/tools/bin/relock.js` and their corresponding source files if any. Remove `embed-examples` related code from `src/building/`.

- [ ] **Step 5: Verify the tools package builds**

Run: `cd packages/tools && node bin/build.js`
Expected: Build succeeds, `dist/` directory created.

- [ ] **Step 6: Add to git**

Run: `git add packages/tools/`

---

### Task 3: Create packages/protocol (base types)

**Files:**
- Create: `packages/protocol/package.json`
- Create: `packages/protocol/tsconfig.json`
- Create: `packages/protocol/src/tsconfig.json`
- Create: `packages/protocol/src/index.ts`
- Create: `packages/protocol/src/types.ts`
- Create: `packages/protocol/src/ChannelLayout.ts`
- Create: `packages/protocol/src/EntityValue.ts`
- Create: `packages/protocol/src/ProtocolAdapter.ts`
- Create: `packages/protocol/src/DmxMapping.ts`
- Create: `packages/protocol/src/RateLimit.ts`

- [ ] **Step 1: Create package.json**

Model after `/Users/ingof/DevOHF/matterjs-server/main-matterjs-server/packages/custom-clusters/package.json`:
- `name`: `"@artnet-bridge/protocol"`
- `version`: `"0.0.0-git"`
- `type`: `"module"`
- `main`: `"dist/esm/index.js"`
- `scripts`: `clean`, `build`, `build-clean` using `artnet-build`
- `engines.node`: `">=22.13.0"`
- No runtime dependencies
- `devDependencies`: `@types/node`
- `files`: `["dist/**/*", "src/**/*", "LICENSE", "README.md"]`
- `publishConfig.access`: `"public"`

- [ ] **Step 2: Create tsconfig files**

`packages/protocol/tsconfig.json`:
```json
{
    "compilerOptions": { "composite": true },
    "files": [],
    "references": [{ "path": "src" }]
}
```

`packages/protocol/src/tsconfig.json`:
```json
{
    "extends": "../../tools/tsc/tsconfig.lib.json",
    "compilerOptions": {
        "types": ["node"]
    },
    "references": []
}
```

- [ ] **Step 3: Create type definition files**

Create the following files per the spec (see `docs/superpowers/specs/2026-03-28-artnet-bridge-design.md` "Core Data Model" section):

`src/ChannelLayout.ts`:
- `ChannelLayout` union type (rgb, rgb-dimmable, scene-selector, brightness)
- `SceneEntry` interface
- `channelWidth()` helper function that returns number of DMX channels for a given ChannelMode

`src/EntityValue.ts`:
- `EntityValue` union type (rgb, rgb-dimmable, scene-selector, brightness)
- `EntityUpdate` interface

`src/types.ts`:
- `Entity`, `EntityMetadata` interfaces
- `ProtocolBridge`, `BridgeMetadata` interfaces
- `DiscoveredBridge`, `PairingResult` interfaces
- `AdapterStatus`, `BridgeStatus` interfaces

`src/DmxMapping.ts`:
- `DmxChannelMapping` interface
- `ChannelMode` type
- `computeDmxEnd()` helper
- `validateMappings()` function (check overlaps, bounds)

`src/RateLimit.ts`:
- `RateLimitBudget` interface

`src/ProtocolAdapter.ts`:
- `ProtocolAdapter` interface (with optional `registerWebHandlers`)

`src/index.ts`:
- Re-export everything from the above files

- [ ] **Step 4: Verify build**

Run: `npm run build` (from root)
Expected: protocol package compiles successfully.

- [ ] **Step 5: Add to git**

Run: `git add packages/protocol/`

---

### Task 4: Install dependencies

- [ ] **Step 1: Run npm install from root**

Run: `npm install`
Expected: All workspace packages linked, node_modules populated, tools package builds.

- [ ] **Step 2: Verify tools build**

Run: `node packages/tools/bin/build.js`
Expected: Tools package builds successfully.

- [ ] **Step 3: Run full build of existing packages**

Run: `npm run build`
Expected: tools, protocol packages compile. artnet/protocol-hue/bridge may be empty stubs but should not error.

---

### Task 5: Create packages/artnet (ArtNet protocol)

**Files:**
- Create: `packages/artnet/package.json`
- Create: `packages/artnet/tsconfig.json`
- Create: `packages/artnet/src/tsconfig.json`
- Create: `packages/artnet/src/index.ts`
- Create: `packages/artnet/src/ArtNetReceiver.ts`
- Create: `packages/artnet/src/ArtNetSender.ts`
- Create: `packages/artnet/src/packets.ts`
- Create: `packages/artnet/src/constants.ts`
- Create: `packages/artnet/test/tsconfig.json`
- Create: `packages/artnet/test/ArtNetPacketTest.ts`
- Create: `packages/artnet/test/ArtNetRoundtripTest.ts`

**Reference:** Analyze `docs/art-net.pdf` for packet format details before implementing.

- [ ] **Step 1: Analyze Art-Net specification**

Read `docs/art-net.pdf` to extract:
- OpOutput (0x5000) packet format: header ("Art-Net\0"), opcode, protocol version, sequence, physical, universe (low+high), length, data
- OpPoll (0x2000) packet format
- OpPollReply (0x2100) packet format
- Header structure: 8 bytes "Art-Net\0" + 2 bytes opcode (little-endian)
- Protocol version: 14 (0x000e, big-endian)
- Universe encoding: 15-bit (low byte + high nibble)
- Document findings as comments in `src/constants.ts`

- [ ] **Step 2: Create package.json**

- `name`: `"@artnet-bridge/artnet"`
- `version`: `"0.0.0-git"`
- `type`: `"module"`
- `main`: `"dist/esm/index.js"`
- No runtime dependencies (only `node:dgram`)
- `devDependencies`: `@types/node`
- `engines.node`: `">=22.13.0"`

- [ ] **Step 3: Create tsconfig files**

Same pattern as protocol package. `src/tsconfig.json` extends `../../tools/tsc/tsconfig.lib.json`. Add `test/tsconfig.json` extending `../../tools/tsc/tsconfig.test.json`.

- [ ] **Step 4: Write failing tests for packet parsing**

`test/ArtNetPacketTest.ts`:
- Test parsing OpOutput packet (valid DMX data, universe extraction, 512 bytes)
- Test parsing OpPoll packet
- Test serializing OpOutput packet (for sender)
- Test edge cases: truncated packet, wrong magic header, empty data
- Test universe encoding (0-based, 15-bit)

Run tests, verify they fail (no implementation yet).

- [ ] **Step 5: Implement packet parsing**

`src/constants.ts`:
- `ARTNET_HEADER`: `"Art-Net\0"` as Buffer
- `ARTNET_PORT`: 6454
- `OP_OUTPUT`: 0x5000
- `OP_POLL`: 0x2000
- `OP_POLL_REPLY`: 0x2100
- `PROTOCOL_VERSION`: 14

`src/packets.ts`:
- `parsePacket(buffer: Buffer)`: returns typed packet or null for invalid
- `serializeOpOutput(universe: number, data: Uint8Array)`: returns Buffer
- `serializeOpPollReply(...)`: returns Buffer
- Types: `ArtDmxPacket`, `ArtPollPacket`, `ArtPollReplyPacket`

- [ ] **Step 6: Run tests, verify they pass**

- [ ] **Step 7: Write failing tests for ArtNetReceiver/Sender roundtrip**

`test/ArtNetRoundtripTest.ts`:
- Send DMX data via `ArtNetSender` on localhost
- Receive via `ArtNetReceiver` on localhost
- Verify universe and data match
- Test multiple universes
- Test poll/reply exchange

- [ ] **Step 8: Implement ArtNetReceiver**

`src/ArtNetReceiver.ts`:
- Constructor: `{ bindAddress?: string; port?: number }`
- `start()`: bind UDP socket on `node:dgram`, parse incoming packets
- `stop()`: close socket
- Event emitter: `"dmx"` event with `(universe: number, data: Uint8Array)`, `"poll"` event
- Auto-reply to polls with OpPollReply

- [ ] **Step 9: Implement ArtNetSender**

`src/ArtNetSender.ts`:
- Constructor: `{ targetAddress?: string; port?: number }`
- `sendDmx(universe: number, data: Uint8Array)`: serialize and send
- `sendPoll()`: send OpPoll
- `close()`: close socket

- [ ] **Step 10: Create index.ts re-exports**

`src/index.ts`: export `ArtNetReceiver`, `ArtNetSender`, packet types, constants.

- [ ] **Step 11: Run all tests, verify they pass**

- [ ] **Step 12: Add to git**

Run: `git add packages/artnet/`

---

### Task 6: Full build and quality verification

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: All packages (tools, protocol, artnet) compile successfully.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Fix any issues.

- [ ] **Step 3: Run format check**

Run: `npm run format-verify`
Fix any issues with `npm run format`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: ArtNet tests pass. Protocol has no tests yet (types only).

- [ ] **Step 5: Add any remaining files to git**

---

## Phase 2: Hue Protocol Adapter

### Task 7: Create packages/protocol-hue scaffold

**Files:**
- Create: `packages/protocol-hue/package.json`
- Create: `packages/protocol-hue/tsconfig.json`
- Create: `packages/protocol-hue/src/tsconfig.json`
- Create: `packages/protocol-hue/src/index.ts`
- Create: `packages/protocol-hue/test/tsconfig.json`

- [ ] **Step 1: Create package.json**

- `name`: `"@artnet-bridge/protocol-hue"`
- `version`: `"0.0.0-git"`
- `type`: `"module"`
- `dependencies`: `@artnet-bridge/protocol` (workspace `"*"`), `node-dtls-client`
- `devDependencies`: `@types/node`
- `engines.node`: `">=22.13.0"`

- [ ] **Step 2: Create tsconfig files**

`src/tsconfig.json`:
```json
{
    "extends": "../../tools/tsc/tsconfig.lib.json",
    "compilerOptions": {
        "types": ["node"]
    },
    "references": [
        { "path": "../../protocol/src" }
    ]
}
```

`test/tsconfig.json`: extends test config, references src.

- [ ] **Step 3: Create empty index.ts, verify build**

- [ ] **Step 4: Add to git**

---

### Task 8: Implement HueClipClient (thin Hue REST API client)

**Files:**
- Create: `packages/protocol-hue/src/HueClipClient.ts`
- Create: `packages/protocol-hue/test/HueClipClientTest.ts`

**Reference:** Check `/Users/ingof/Dev/GitHub/artnet-hue-entertainment/src/hue-api.ts` and `/Users/ingof/Dev/GitHub/artnet-hue-entertainment/src/hue-v2.ts` for endpoint patterns. Check `/Users/ingof/Dev/GitHub/node-hue-api/docs/` for API details.

- [ ] **Step 1: Write failing tests**

Mock `fetch` (globalThis.fetch override in test setup). Test:
- `getLights()` returns parsed light list
- `getRooms()`, `getZones()`, `getGroupedLights()`, `getScenes()` return parsed lists
- `setLightState(id, state)` sends correct PUT
- `setGroupedLightState(id, state)` sends correct PUT
- `activateScene(id)` sends correct PUT
- `getEntertainmentConfigurations()` returns parsed list
- `startEntertainment(id)` / `stopEntertainment(id)` send correct PUT
- `createUser()` sends correct POST to `/api`
- HTTPS with self-signed cert handling (Node `fetch` with custom agent)

- [ ] **Step 2: Implement HueClipClient**

```typescript
class HueClipClient {
    constructor(host: string, username: string);
    // All CLIP v2 resource endpoints from the spec
    // Uses native fetch with HTTPS, rejectUnauthorized: false for local bridges
}
```

Use `node:https` Agent with `rejectUnauthorized: false` passed to fetch for self-signed cert handling on Hue bridges.

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Add to git**

---

### Task 9: Implement HueDiscovery

**Files:**
- Create: `packages/protocol-hue/src/HueDiscovery.ts`
- Create: `packages/protocol-hue/test/HueDiscoveryTest.ts`

**Reference:** Check `/Users/ingof/Dev/GitHub/node-hue-api/docs/discovery.md` and `/Users/ingof/Dev/GitHub/artnet-hue-entertainment/src/cli.ts` (discover command).

- [ ] **Step 1: Write failing tests**

- Test mDNS discovery (mock `node:dgram` multicast)
- Test `discovery.meethue.com` fallback (mock fetch)
- Test result merging and deduplication

- [ ] **Step 2: Implement HueDiscovery**

- mDNS query for `_hue._tcp.local`
- HTTP fallback to `https://discovery.meethue.com`
- Returns `DiscoveredBridge[]`

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Add to git**

---

### Task 10: Implement HuePairing

**Files:**
- Create: `packages/protocol-hue/src/HuePairing.ts`
- Create: `packages/protocol-hue/test/HuePairingTest.ts`

**Reference:** Check `/Users/ingof/Dev/GitHub/artnet-hue-entertainment/src/cli.ts` (pair command).

- [ ] **Step 1: Write failing tests**

- Test successful pairing returns username + clientKey
- Test pairing failure (link button not pressed) returns error
- Test timeout handling

- [ ] **Step 2: Implement HuePairing**

Uses `HueClipClient.createUser()` under the hood. Returns `PairingResult` with `connection: { username, clientKey, host }`.

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Add to git**

---

### Task 11: Implement HueDtlsStream (Entertainment streaming)

**Files:**
- Create: `packages/protocol-hue/src/HueDtlsStream.ts`
- Create: `packages/protocol-hue/test/HueDtlsStreamTest.ts`

**Reference:** Check `/Users/ingof/Dev/GitHub/artnet-hue-entertainment/src/hue-dtls.ts` for packet format and DTLS setup. Check `docs/HueEntertainmentAPI.html` for authoritative byte layout.

- [ ] **Step 1: Analyze Hue Entertainment API documentation**

Read `docs/HueEntertainmentAPI.html` to extract:
- Exact packet byte layout (HueStream header fields, version bytes, color space, UUID encoding)
- DTLS handshake requirements (PSK identity source, cipher suite)
- Best practices: 50-60Hz streaming rate, bridge sends max 25Hz over ZigBee, effect rate <12.5Hz
- Timeout behavior (bridge disconnects after ~10s of no packets)
- Entertainment configuration start/stop REST calls
Document findings as comments in implementation.

- [ ] **Step 2: Write failing tests**

- Test packet construction (header, UUID, per-channel color data, correct byte layout)
- Test continuous 50Hz send loop (mock timer, verify interval)
- Test value update (new values reflected in next packet)
- Test reconnection logic (mock DTLS connection drop, verify backoff)
- Use mock UDP server to validate packet format

- [ ] **Step 2: Implement HueDtlsStream**

```typescript
class HueDtlsStream {
    constructor(host: string, pskIdentity: string, clientKey: string, entertainmentConfigId: string);
    connect(): Promise<void>;
    close(): Promise<void>;
    updateValues(updates: Array<{ channelId: number; color: [number, number, number] }>): void;
    // Internal: 50Hz continuous send loop
    // Internal: exponential backoff reconnection
}
```

Key behaviors:
- Continuous packet send at ~50Hz (setInterval 20ms)
- Always sends current state (UDP loss compensation)
- `updateValues()` updates internal buffer, next tick sends new values
- Reconnection: re-activate entertainment config via REST, then DTLS handshake
- DTLS config: PSK identity from `/auth/v1`, PSK secret from clientKey, cipher suite `TLS_PSK_WITH_AES_128_GCM_SHA256`, port 2100

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Add to git**

---

### Task 12: Implement HueProtocolAdapter

**Files:**
- Create: `packages/protocol-hue/src/HueProtocolAdapter.ts`
- Create: `packages/protocol-hue/test/HueProtocolAdapterTest.ts`

- [ ] **Step 1: Write failing tests**

- Test `getBridges()` returns correct `ProtocolBridge[]` structure with entities
- Test entity classification: entertainment area lights → `controlMode: "realtime"`, others → `"limited"`
- Test auto-exclusion: lights in entertainment area not exposed as limited
- Test rate limit declaration (light: 10/s, group: 1/s, scene: 1/s, realtime: ~6Hz)
- Test `handleRealtimeUpdate()` forwards to `HueDtlsStream.updateValues()`
- Test `handleLimitedUpdate()` calls correct CLIP v2 endpoint (light PUT, group PUT, scene PUT)
- Test `handleLimitedUpdate()` awaits response before returning (critical for rate limit correctness)
- Test `discover()` delegates to `HueDiscovery`
- Test `pair()` delegates to `HuePairing`
- Test `registerWebHandlers()` registers Hue-specific routes
- Test error handling: REST 429 → back off 1 second on that category
- Test error handling: bridge unreachable → mark disconnected, retry with backoff
- Test error handling: entertainment area claimed → mark unavailable, retry periodically

- [ ] **Step 2: Implement HueProtocolAdapter**

Implements `ProtocolAdapter` from `@artnet-bridge/protocol`. Orchestrates all Hue-specific components:
- `connect()`: for each configured bridge, initialize `HueClipClient`, fetch resources, identify entertainment area lights, start DTLS stream if entertainment configured
- `getBridges()`: map Hue resources to generic `ProtocolBridge` / `Entity` model
- `handleRealtimeUpdate()`: forward to DTLS stream
- `handleLimitedUpdate()`: call appropriate CLIP v2 endpoint, **await the response**
- `getStatus()`: aggregate DTLS and REST connection status

Entity mapping logic:
- Each Hue light → Entity with `category: "light"`, `channelLayout: { type: "rgb" }`
- Each Hue room/zone → Entity with `category: "group"`, `channelLayout: { type: "brightness" }` (or rgb for color groups)
- Scene selectors per room/zone → Entity with `category: "scene"`, `channelLayout: { type: "scene-selector", scenes: [...] }`
- Entertainment area lights → `controlMode: "realtime"`, all others → `"limited"`
- `channelLayout` per entity: lights get `{ type: "rgb" }` (user can map as 8bit, 8bit-dimmable, or 16bit); groups get `{ type: "brightness" }` or `{ type: "rgb" }` depending on group capabilities; scene selectors get `{ type: "scene-selector", scenes: [...] }`
- Implement `registerWebHandlers()`: register routes under `/protocol/hue/` for Hue-specific pages (pairing flow, entertainment area selection, diagnostics)
- Error handling per spec: REST 429 → back off 1s; bridge unreachable → backoff reconnection; entertainment claimed → retry every 30s

- [ ] **Step 3: Update src/index.ts exports**

Export `HueProtocolAdapter` and any types needed by the bridge package.

- [ ] **Step 4: Run all tests, verify pass**

- [ ] **Step 5: Add to git**

---

## Phase 3: Bridge Core

### Task 13: Create packages/bridge scaffold

**Files:**
- Create: `packages/bridge/package.json`
- Create: `packages/bridge/tsconfig.json`
- Create: `packages/bridge/src/tsconfig.json`
- Create: `packages/bridge/src/index.ts`
- Create: `packages/bridge/test/tsconfig.json`

- [ ] **Step 1: Create package.json**

- `name`: `"artnet-bridge"`
- `version`: `"0.0.0-git"`
- `type`: `"module"`
- `main`: `"dist/esm/index.js"`
- `bin`: `{ "artnet-bridge": "dist/esm/cli.js" }`
- `dependencies`: `@artnet-bridge/artnet`, `@artnet-bridge/protocol`, `@artnet-bridge/protocol-hue` (all workspace `"*"`), `express`
- `devDependencies`: `@types/node`, `@types/express`
- `engines.node`: `">=22.13.0"`

- [ ] **Step 2: Create tsconfig files**

`src/tsconfig.json` with references to `../../artnet/src`, `../../protocol/src`, `../../protocol-hue/src`.

- [ ] **Step 3: Verify build**

- [ ] **Step 4: Add to git**

---

### Task 14: Implement Config Manager

**Files:**
- Create: `packages/bridge/src/config/ConfigManager.ts`
- Create: `packages/bridge/src/config/ConfigSchema.ts`
- Create: `packages/bridge/src/config/ConfigLock.ts`
- Create: `packages/bridge/test/config/ConfigManagerTest.ts`

- [ ] **Step 1: Write failing tests**

- Test loading config from file (valid JSON)
- Test creating default config when file doesn't exist
- Test validation: reject config with dmxEnd > 512, overlapping channels, invalid universe
- Test validation: channelMode must be compatible with entity's channelLayout type (e.g., scene-selector mode only valid for scene-selector layout)
- Test validation: rate limit overrides cannot exceed hard max
- Test error handling: corrupt/unparseable config → refuse to start with clear error
- Test file locking: acquire lock, check PID, release lock
- Test stale lock cleanup (PID not running)
- Test schema migration (version bump with backup)

- [ ] **Step 2: Implement ConfigSchema.ts**

`AppConfig`, `BridgeConfig` interfaces per spec. Include `DEFAULT_CONFIG` constant. Include `validateConfig()` function.

- [ ] **Step 3: Implement ConfigLock.ts**

PID-based file locking at `~/.artnet-bridge/config.lock`. Methods: `acquire()`, `release()`, `isLocked()`, `cleanStale()`.

- [ ] **Step 4: Implement ConfigManager.ts**

Methods: `load()`, `save()`, `getDefault()`, `validate()`. Uses `ConfigLock` for concurrent access protection. Handles `~/.artnet-bridge/` directory creation.

- [ ] **Step 5: Run tests, verify pass**

- [ ] **Step 6: Add to git**

---

### Task 15: Implement DMX Mapper

**Files:**
- Create: `packages/bridge/src/dmx/DmxMapper.ts`
- Create: `packages/bridge/test/dmx/DmxMapperTest.ts`

- [ ] **Step 1: Write failing tests**

- Test 8bit extraction: 3 bytes → RGB normalized to 0-65535 (multiply by 257)
- Test 8bit-dimmable extraction: 4 bytes → DRGB normalized
- Test 16bit extraction: 6 bytes → RGB as (coarse<<8)|fine
- Test scene-selector extraction: 1 byte → scene lookup, value 0 = skip, out of range = skip
- Test brightness extraction: 1 byte → 0-65535
- Test multiple entities from same DMX frame
- Test entity on different universe is not extracted

- [ ] **Step 2: Implement DmxMapper**

```typescript
class DmxMapper {
    constructor(mappings: Map<string, { bridgeId: string; mapping: DmxChannelMapping; entity: Entity }>);
    extractValues(universe: number, data: Uint8Array): Map<string, { bridgeId: string; entityId: string; value: EntityValue }>;
}
```

Performs value normalization per the spec:
- 8bit: byte * 257
- 8bit-dimmable: dim and RGB each * 257
- 16bit: (coarse << 8) | fine
- scene-selector: lookup in SceneEntry[]
- brightness: byte * 257

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Add to git**

---

### Task 16: Implement Rate Limit Scheduler

**Files:**
- Create: `packages/bridge/src/scheduler/RealtimeScheduler.ts`
- Create: `packages/bridge/src/scheduler/LimitedScheduler.ts`
- Create: `packages/bridge/test/scheduler/RealtimeSchedulerTest.ts`
- Create: `packages/bridge/test/scheduler/LimitedSchedulerTest.ts`

- [ ] **Step 1: Write failing tests for RealtimeScheduler**

- Test: update entity, tick → entity in dirty batch
- Test: update entity twice before tick → only latest value in batch
- Test: tick clears dirty set
- Test: no updates → empty batch on tick
- Test: tick rate matches configured rate limit

- [ ] **Step 2: Implement RealtimeScheduler**

```typescript
class RealtimeScheduler {
    constructor(rateHz: number, onTick: (updates: EntityUpdate[]) => Promise<void>);
    update(entityId: string, value: EntityValue): void;
    start(): void;
    stop(): void;
}
```

Uses `Set<string>` for dirty tracking, `Map<string, EntityValue>` for latest values. `setInterval` at `1000/rateHz` ms.

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Write failing tests for LimitedScheduler**

- Test: update entity, tick → entity dispatched
- Test: update 3 entities, tick 3 times → round-robin, first-in-first-out
- Test: entity updated again while waiting → stays at original position, value updated
- Test: tick skipped if previous call still pending
- Test: entity not re-queued after dispatch until next value change
- Test: budget shared across entities in same category

- [ ] **Step 5: Implement LimitedScheduler**

```typescript
class LimitedScheduler {
    constructor(ratePerSec: number, onDispatch: (entityId: string, value: EntityValue) => Promise<void>);
    update(entityId: string, value: EntityValue): void;
    start(): void;
    stop(): void;
}
```

Uses `Set<string>` as insertion-ordered queue, `Map<string, EntityValue>` for latest values. Tick rate = `1000/ratePerSec` ms. Skips tick if `onDispatch` promise from previous tick hasn't resolved.

**Important:** The `BridgeOrchestrator` (Task 17) creates one `LimitedScheduler` **per bridge per category** (e.g., bridge-1 gets separate schedulers for "light" at 10/sec, "group" at 1/sec, "scene" at 1/sec). Each scheduler manages its own dirty set and rate budget independently. Similarly, one `RealtimeScheduler` per bridge for all realtime entities on that bridge.

- [ ] **Step 6: Run tests, verify pass**

- [ ] **Step 7: Add to git**

---

### Task 17: Implement Bridge Orchestrator

**Files:**
- Create: `packages/bridge/src/BridgeOrchestrator.ts`
- Create: `packages/bridge/test/BridgeOrchestratorTest.ts`

- [ ] **Step 1: Write failing tests**

- Test: DMX frame dispatched to correct bridge by universe
- Test: entities routed to correct scheduler (realtime vs limited)
- Test: multiple bridges on same universe both receive data
- Test: adapter connect/disconnect lifecycle
- Test: status aggregation from adapters
- Test: ArtNet bind failure exits with clear error message
- Test: creates separate LimitedScheduler per bridge per category

- [ ] **Step 2: Implement BridgeOrchestrator**

```typescript
class BridgeOrchestrator {
    constructor(config: AppConfig, artnetReceiver: ArtNetReceiver);
    start(): Promise<void>;
    stop(): Promise<void>;
    getStatus(): RuntimeStatus;
}
```

Responsibilities:
- Load protocol adapters based on config
- Call `adapter.connect()` for each
- Set up `DmxMapper` from config channel mappings
- Create one `RealtimeScheduler` per bridge (batches all realtime entities)
- Create one `LimitedScheduler` per bridge **per category** (e.g., "light", "group", "scene" each get their own scheduler with their own rate budget)
- Listen to ArtNet receiver `"dmx"` events → extract values via DmxMapper → route to schedulers
- Expose runtime status for web UI

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Add to git**

---

## Phase 4: Web UI & CLI

### Task 18: Implement Express web server

**Files:**
- Create: `packages/bridge/src/web/WebServer.ts`
- Create: `packages/bridge/src/web/routes/configRoutes.ts`
- Create: `packages/bridge/src/web/routes/bridgeRoutes.ts`
- Create: `packages/bridge/src/web/routes/statusRoutes.ts`
- Create: `packages/bridge/src/web/WebSocketHandler.ts`

**Reference:** Check `/Users/ingof/DevOHF/matterjs-server/main-matterjs-server/packages/matter-server/src/` for Express server patterns and static file serving.

- [ ] **Step 1: Write failing tests for WebServer and routes**

Create: `packages/bridge/test/web/WebServerTest.ts`
Create: `packages/bridge/test/web/WebSocketHandlerTest.ts`

Tests:
- Test config routes: GET /api/config returns config, PUT /api/config validates and saves
- Test bridge routes: GET /api/bridges/discover triggers discovery, POST /api/bridges/pair initiates pairing
- Test status route: GET /api/status returns runtime status snapshot
- Test protocol handler mounting: adapters' routes registered under `/protocol/<type>/`
- Test WebSocket: subscribe message → client receives status updates for that bridge
- Test WebSocket: unsubscribe → client stops receiving updates
- Test WebSocket: no subscriptions → no data pushed
- Test WebSocket: multiple clients, independent subscriptions

- [ ] **Step 2: Implement WebServer.ts**

Express app with:
- Static file serving from `public/` (bundled frontend)
- Router mounting: `/api/config/*`, `/api/bridges/*`, `/api/status/*`
- Protocol adapter route mounting under `/protocol/<type>/`
- WebSocket upgrade handling

- [ ] **Step 3: Implement config routes**

- `GET /api/config` — load current config
- `PUT /api/config` — save config (with validation + lock)

- [ ] **Step 4: Implement bridge routes**

- `GET /api/bridges/discover` — trigger discovery
- `POST /api/bridges/pair` — initiate pairing
- `GET /api/bridges/:id/resources` — list entities for a bridge

- [ ] **Step 5: Implement WebSocketHandler.ts**

- Handle `subscribe` / `unsubscribe` messages
- Track subscriptions per client
- Push status updates only for subscribed bridges
- All messages use `type` discriminator

- [ ] **Step 6: Implement status routes**

- `GET /api/status` — global status snapshot (for initial page load)

- [ ] **Step 7: Run tests, verify pass**

- [ ] **Step 8: Add to git**

---

### Task 19: Build web UI frontend

**Files:**
- Create: `packages/bridge/src/web/public/index.html`
- Create: `packages/bridge/src/web/public/app.js`
- Create: `packages/bridge/src/web/public/app.css`
- Create: `packages/bridge/rollup.config.mjs` (if bundling needed)

**Reference:** Check `/Users/ingof/Dev/GitHub/artnet-hue-entertainment/src/web/public/` for UI patterns.

- [ ] **Step 1: Create index.html shell**

Dark theme, minimal structure. Sections: header, bridge list, ArtNet status footer.

- [ ] **Step 2: Create app.css**

Dark theme styles. Compact card layout for bridges. Badge styles for "realtime" / "limited". Collapsible detail panels.

- [ ] **Step 3: Create app.js**

Vanilla JS SPA:
- Fetch config on load, render bridge cards
- Compact default view (connection status, entity counts)
- Toggle detail panel per bridge → subscribe via WebSocket → show live data
- Close panel → unsubscribe
- Config editing: discover, pair, channel mapping
- Test controls: solid color buttons in detail panel
- Protocol-specific page links per bridge

- [ ] **Step 4: Set up Rollup config (if using modules)**

If the frontend uses ES modules or needs bundling, create `rollup.config.mjs`. Otherwise, serve vanilla JS directly.

- [ ] **Step 5: Add copy-web-assets to build scripts**

Ensure `public/` files are copied to `dist/` during build.

- [ ] **Step 6: Test manually: start server, open browser, verify UI loads**

- [ ] **Step 7: Add to git**

---

### Task 20: Implement CLI

**Files:**
- Create: `packages/bridge/src/cli.ts`

- [ ] **Step 1: Write failing tests for CLI**

Create: `packages/bridge/test/cli/CliTest.ts`

Tests:
- Test argument parsing: `--config`, `--port`, `--no-web` flags parsed correctly
- Test default values: config path = `~/.artnet-bridge/config.json`, port = 8080, web = enabled
- Test `config discover` subcommand triggers discovery
- Test `config pair <host>` subcommand triggers pairing
- Test graceful shutdown on SIGINT

- [ ] **Step 2: Implement cli.ts**

```typescript
#!/usr/bin/env node
// Parse args: --config, --port, --no-web
// Load config
// Create ArtNetReceiver
// Create BridgeOrchestrator
// Create WebServer (unless --no-web)
// Start everything
// Handle SIGINT/SIGTERM for graceful shutdown
```

- [ ] **Step 3: Add shebang and make executable**

Ensure `#!/usr/bin/env node` at top. Set executable bit in build script.

- [ ] **Step 4: Implement config subcommands**

`artnet-bridge config discover` — run discovery, print results
`artnet-bridge config pair <host>` — interactive pairing (prompt for link button)

- [ ] **Step 5: Run tests, verify pass**

- [ ] **Step 6: Test CLI manually**

Run: `node packages/bridge/dist/esm/cli.js --help` (or similar)
Expected: Shows usage.

- [ ] **Step 7: Add to git**

---

## Phase 5: GitHub Actions & Documentation

### Task 21: Set up GitHub Actions

**Files:**
- Create: `.github/actions/prepare-env/action.yml`
- Create: `.github/workflows/build-test.yml`
- Create: `.github/workflows/nightly-dev-release.yml`
- Create: `.github/workflows/official-release.yml`
- Create: `.github/workflows/release-npm.yml`
- Create: `.github/workflows/auto-approve-release.yml`

**Reference:** Copy from `/Users/ingof/DevOHF/matterjs-server/main-matterjs-server/.github/` and adapt.

- [ ] **Step 1: Create prepare-env action**

Copy from matterjs-server. Update Node version default to `22.x`.

- [ ] **Step 2: Create build-test.yml**

Copy from matterjs-server. Adapt:
- Remove Python test job
- Update Node version matrix to `[22.x, 24.x]`
- Remove matter.js specific path filters
- Keep: lint+format job, multi-platform build, test job

- [ ] **Step 3: Create release workflows**

Copy `nightly-dev-release.yml`, `official-release.yml`, `release-npm.yml`, `auto-approve-release.yml` from matterjs-server. Adapt:
- Remove Docker build/push steps from `release-npm.yml`
- Remove Python/PyPI publish steps from `release-npm.yml`
- Update repo references
- Update Node versions

- [ ] **Step 4: Verify workflow syntax**

Run: `npx yaml-lint .github/workflows/*.yml` (or manually review)

- [ ] **Step 5: Add to git**

---

### Task 22: Write documentation

**Files:**
- Modify: `README.md` (root)
- Create: `docs/cli.md`
- Create: `docs/configuration.md`
- Create: `docs/web-ui.md`
- Create: `docs/developing-protocols.md`
- Create: `packages/artnet/README.md`
- Create: `packages/protocol/README.md`
- Create: `packages/protocol-hue/README.md`
- Create: `packages/bridge/README.md`

- [ ] **Step 1: Write root README.md**

Project overview, features, quick start (install, first run, pair a Hue bridge, map DMX channels), links to detailed docs and package READMEs.

- [ ] **Step 2: Write docs/cli.md**

All CLI flags and subcommands with examples.

- [ ] **Step 3: Write docs/configuration.md**

Full config file format documentation, all fields, defaults, rate limit configuration, validation rules.

- [ ] **Step 4: Write docs/web-ui.md**

How to use the web UI, detail panel, WebSocket protocol.

- [ ] **Step 5: Write docs/developing-protocols.md**

How to create a new protocol adapter: implement `ProtocolAdapter`, register web handlers, declare rate limits, expose entities.

- [ ] **Step 6: Write packages/artnet/README.md**

ArtNet protocol details, `ArtNetReceiver`/`ArtNetSender` API, simulator usage for testing.

- [ ] **Step 7: Write packages/protocol/README.md**

Base types overview, how to implement `ProtocolAdapter`, entity model.

- [ ] **Step 8: Write packages/protocol-hue/README.md**

Detailed Hue-specific docs per spec: two control modes (Entertainment vs Standard), entertainment area setup, auto-exclusion, rate limits per resource type, channel modes, config examples.

- [ ] **Step 9: Write packages/bridge/README.md**

Main app architecture, how adapters are loaded, config management.

- [ ] **Step 10: Add to git**

---

## Phase 6: Integration Testing & Polish

### Task 23: End-to-end integration test

**Files:**
- Create: `packages/bridge/test/integration/EndToEndTest.ts`

- [ ] **Step 1: Write integration test**

- Create mock protocol adapter (implements `ProtocolAdapter`, records calls)
- Start ArtNet receiver + bridge orchestrator + mock adapter
- Send DMX data via `ArtNetSender`
- Verify mock adapter receives correct `handleRealtimeUpdate` / `handleLimitedUpdate` calls
- Verify rate limiting behavior (limited calls respect budget, await completion)
- Verify realtime batching (dirty set cleared per tick)
- Test WebSocket integration: subscribe to bridge → receive live status updates reflecting DMX changes
- Test WebSocket integration: unsubscribe → stop receiving updates

- [ ] **Step 2: Run test, verify pass**

- [ ] **Step 3: Add to git**

---

### Task 24: Final build verification

- [ ] **Step 1: Clean build from scratch**

Run: `npm run build-clean`
Expected: All packages compile successfully.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Run lint + format**

Run: `npm run lint && npm run format-verify`
Expected: No issues.

- [ ] **Step 4: Verify CLI starts**

Run: `node packages/bridge/dist/esm/cli.js`
Expected: Server starts, listens on ArtNet port, web UI accessible.

- [ ] **Step 5: Manual smoke test**

- Open web UI in browser
- Verify compact bridge view renders
- If Hue bridge available: test discovery, pairing, channel mapping
- Use ArtNet sender to send test data, verify status updates in UI

- [ ] **Step 6: Final git add for any remaining files**
