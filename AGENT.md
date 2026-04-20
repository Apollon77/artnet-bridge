# ArtNet Bridge -- Agent Context

ArtNet Bridge receives Art-Net/DMX data over UDP and forwards it to IoT lighting protocols (currently Philips Hue). It supports both realtime entertainment streaming (DTLS, ~50Hz) and rate-limited REST control, with a web UI for configuration.

## Monorepo structure

```
packages/
  tools/          @artnet-bridge/tools      (private) Build tooling, tsconfig hierarchy, esbuild+tsc
  protocol/       @artnet-bridge/protocol   Base types & interfaces (Entity, ProtocolAdapter, etc.)
  artnet/         @artnet-bridge/artnet     ArtNet UDP receiver/sender, packet parser/serializer
  protocol-hue/   @artnet-bridge/protocol-hue  Hue adapter: CLIP v2 REST, DTLS entertainment, discovery, pairing
  bridge/         artnet-bridge             Main package: orchestrator, schedulers, DMX mapper, web UI, CLI
```

Dependency graph:

```
bridge --> artnet, protocol, protocol-hue
protocol-hue --> protocol
artnet --> (none)
protocol --> (none)
tools --> (standalone, provides build scripts)
```

## Tech stack

- TypeScript (strict, `~5.9.3`), ESM-only
- Node >= 22.13.0
- npm workspaces
- Build: esbuild (bundling) + tsc (type checking/declarations)
- Lint: oxlint (`--type-aware`), Format: oxfmt
- Test: mocha (config in `.mocharc.yml`, spec pattern: `packages/*/build/esm/test/**/*Test.js`)
- Express 5, ws (WebSocket)

## Build / test / lint commands

```bash
npm run build              # Build all packages (tsc + esbuild + bundle)
npm run build-clean        # Clean then build
npm test                   # Run all tests (mocha)
npm run lint               # oxlint --type-aware
npm run lint-fix           # oxlint --fix --type-aware
npm run format             # oxfmt "packages/**/*.ts"
npm run format-verify      # oxfmt --check "packages/**/*.ts"
npm run bridge             # Run from built source (packages/bridge/dist/esm/cli.js)
```

After every change: `npm run build && npm run lint && npm run format`

## Coding standards (CRITICAL -- read before writing any code)

### NEVER use `as Type` casts

Use type guards, discriminated union narrowing, or duck-typing instead. There is exactly ONE exception: the API trust boundary in `HueClipClient.clipGet()` where CLIP v2 response data is cast after envelope validation. Every other `as` cast is a bug.

Pattern to follow -- duck-type guard:
```typescript
function isRouterLike(obj: unknown): obj is RouterLike {
  if (obj === null || obj === undefined) return false;
  if (typeof obj !== "object" && typeof obj !== "function") return false;
  return "use" in obj && typeof obj.use === "function"
      && "get" in obj && typeof obj.get === "function";
}
```

Pattern to follow -- property check with type guard:
```typescript
function hasStringProp<K extends string>(obj: object, key: K): obj is object & Record<K, string> {
  return key in obj && typeof (obj as Record<string, unknown>)[key] === "string";
}
```

### NEVER use `void asyncCall()`

The `@typescript-eslint/no-floating-promises` rule is enforced. Always handle async results:
```typescript
// BAD
void doSomething();

// GOOD
doSomething().catch((err) => console.error("Error:", err));
// or
await doSomething();
```

### Error handling requirements

- All Express route handlers: wrap body in try/catch, return 500 with error message
- All async code in event handlers (`setInterval`, `socket.on`, etc.): must `.catch()` errors
- Shutdown (`stop()`) methods: wrap each step in individual try/catch so one failure does not skip cleanup

### Value comparison

Use `isDeepEqual` from `@artnet-bridge/protocol` instead of `JSON.stringify` for value comparison. Both schedulers use this for dedup.

### Other enforced rules

- No unused imports, no unused variables (oxlint + tsc both enforce)
- `prefer-const`, `no-var`, `strict` mode
- All imports use `.js` extension (ESM requirement)
- No `innerHTML` in web UI -- use `createElement`/`textContent`

## File organization

### tsconfig hierarchy

```
packages/tools/tsc/tsconfig.base.json    -- Shared compiler options (strict, es2022, node16)
packages/tools/tsc/tsconfig.lib.json     -- For library source (emitDeclarationOnly, outDir dist/esm)
packages/tools/tsc/tsconfig.app.json     -- For app/test builds (noEmit)
packages/*/tsconfig.json                 -- Root per-package, references src/ and test/
packages/*/src/tsconfig.json             -- Extends tsconfig.lib.json, declares references to deps
```

### Adding a new file

1. Create `.ts` file in the package's `src/` directory
2. Import it from `src/index.ts` (if it should be public API) or import directly where needed
3. Use `.js` extension in import paths
4. Run build to verify

### Package.json patterns

- All packages use `"type": "module"`, `"main": "dist/esm/index.js"`
- Workspace deps use `"*"` version
- Build scripts: `nacho-build` (from tools package)

## Key design patterns

### Protocol adapter interface

`packages/protocol/src/ProtocolAdapter.ts` -- All protocol implementations must implement this:
- `connect()` / `disconnect()` -- lifecycle
- `discover()` / `pair()` -- bridge discovery and pairing
- `getBridges()` -- returns `ProtocolBridge[]` with entities and rate limits
- `handleRealtimeUpdate(bridgeId, updates[])` -- batched realtime updates (entertainment streaming)
- `handleLimitedUpdate(bridgeId, entityId, value)` -- individual rate-limited updates (REST)
- `registerWebHandlers?(router)` -- optional protocol-specific web routes

### Entity model

Flat `Entity` with:
- `controlMode`: `"realtime"` (entertainment DTLS) or `"limited"` (REST API)
- `category`: `"realtime-light"`, `"light"`, `"group"`, `"scene"` -- determines rate limit bucket
- `channelLayout`: `"rgb"`, `"rgb-dimmable"`, `"scene-selector"`, `"brightness"` -- determines DMX channel count

### Rate limiting

Two scheduler types in `packages/bridge/src/scheduler/`:

**RealtimeScheduler**: Dirty-set batching. Collects changed entities, dispatches all dirty entities as a single batch on each tick. Used for entertainment streaming.

**LimitedScheduler**: FIFO round-robin. Each tick dispatches the single most-stale dirty entity. Awaits completion before next dispatch (`dispatching` flag). One instance per bridge per category.

Both schedulers skip dispatch when value is unchanged since last send (using `isDeepEqual`).

### Partial DMX frame accumulation

`BridgeOrchestrator.handleDmx()` maintains a 512-byte buffer per universe. Incoming frames (which may be shorter than 512 bytes) are accumulated into this buffer. The full buffer is then passed to `DmxMapper.extractValues()`.

### Config

Config file at `~/.artnet-bridge/config.json` with PID-based file locking (`ConfigLock`). Schema in `packages/bridge/src/config/ConfigSchema.ts`. Channel mappings use `targetId` (the entity ID), NOT a field called `entityId`.

## How to add a new protocol adapter

1. Create `packages/protocol-<name>/` with standard package.json (depend on `@artnet-bridge/protocol`)
2. Implement `ProtocolAdapter` interface
3. Add `src/tsconfig.json` extending `../../tools/tsc/tsconfig.lib.json`
4. Register factory in `packages/bridge/src/cli.ts` (`adapterFactories.set(...)`)
5. Add workspace to root `package.json` workspaces array
6. Add reference in `packages/bridge/src/tsconfig.json`
7. Optionally implement `registerWebHandlers()` for protocol-specific web routes
8. Add dependency in `packages/bridge/package.json`

## How to add a new entity value type

All locations that must be updated:

1. `packages/protocol/src/EntityValue.ts` -- add to `EntityValue` union
2. `packages/protocol/src/ChannelLayout.ts` -- add to `ChannelLayout` union and `channelWidth()` switch
3. `packages/bridge/src/dmx/DmxMapper.ts` -- add case in `extractEntityValue()` switch
4. `packages/protocol-hue/src/HueProtocolAdapter.ts`:
   - `handleRealtimeUpdate()` -- add case for the new value type
   - `applyColorState()` -- add case for the new value type in REST dispatch
5. `packages/bridge/src/web/public/app.js`:
   - `entityValueToRgb()` -- add conversion for UI display
   - `mappingCompatibleModes()` -- add compatible channel modes for the new layout type
6. `packages/bridge/src/web/routes/bridgeRoutes.ts` -- update test route if applicable

## Subdirectory AGENT.md files

- `packages/protocol-hue/AGENT.md` -- Hue-specific protocol knowledge (entertainment streaming, REST API quirks, color conversion, DTLS workarounds)
- `packages/artnet/AGENT.md` -- ArtNet protocol details (packet format, universe addressing, PollReply)
- `packages/bridge/AGENT.md` -- Orchestrator startup, shutdown, DMX dispatch flow, config schema, web UI
- `packages/protocol/AGENT.md` -- Base types, adding new value types and channel modes

## Git workflow

Work on `main` branch. One commit per logical change. Never commit without asking the user first. Co-Author line required on all commits.
