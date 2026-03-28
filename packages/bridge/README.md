# artnet-bridge

Main application package. Orchestrates ArtNet reception, DMX mapping, rate-limited dispatch, protocol adapters, and the web UI.

## Architecture

```
CLI (cli.ts)
  |
  +-- ConfigManager         Load/save/validate config with file locking
  |
  +-- BridgeOrchestrator    Central coordinator
  |     +-- ArtNetReceiver  Listens for ArtNet UDP packets
  |     +-- DmxMapper       Extracts per-entity channel values from raw DMX
  |     +-- Schedulers
  |     |     +-- RealtimeScheduler   Dirty-set batching for streaming entities
  |     |     +-- LimitedScheduler    Rate-limited round-robin for API entities
  |     +-- Protocol Adapters (loaded per bridge config)
  |
  +-- WebServer             Express-based HTTP + WebSocket
        +-- Config routes   REST API for config CRUD
        +-- Bridge routes   Discovery, pairing, bridge management
        +-- Status routes   System status
        +-- WebSocketHandler  Live status push with per-bridge subscriptions
```

## Protocol Adapter Loading

Adapters are registered as factory functions keyed by protocol type. When the orchestrator starts, it creates an adapter instance for each configured bridge:

```typescript
const adapterFactories = new Map<string, ProtocolAdapterFactory>();
adapterFactories.set("hue", (bridgeConfig) => {
  return new HueProtocolAdapter({ ... });
});
```

To add a new protocol, register its factory in `cli.ts` and add the package dependency. See [Developing Protocol Adapters](../../docs/developing-protocols.md).

## Config Management

- Default location: `~/.artnet-bridge/config.json`
- Override with `--config <path>`
- PID-based file locking prevents concurrent writes from server and CLI
- Auto-creates default config on first run
- Schema migration support with automatic backup

See [Configuration](../../docs/configuration.md) for the full schema.

## Dispatch Strategies

### Realtime (streaming entities)

- Dirty set tracks which entities have changed
- On each rate tick (~6Hz), all dirty entities are batched and sent to the adapter via `handleRealtimeUpdate`
- The adapter maintains its own continuous transmission (e.g., Hue DTLS at 50Hz)

### Limited (API entities)

- Insertion-ordered dirty set provides fair round-robin
- One API call per rate tick, waiting for the previous call to complete before sending the next
- Rate budget shared across all entities in the same category on the same bridge

## Web UI

The web server provides:
- Static file serving for the bundled frontend (vanilla JS/HTML/CSS, dark theme)
- REST API for config and bridge management
- WebSocket for live status with per-bridge subscriptions

See [Web UI](../../docs/web-ui.md) for usage details.

## CLI

```bash
artnet-bridge                              # start server
artnet-bridge --config /path/config.json   # custom config
artnet-bridge --port 9090                  # custom web port
artnet-bridge --no-web                     # headless
artnet-bridge config discover              # find bridges
artnet-bridge config pair <host>           # pair with a bridge
```

See [CLI Usage](../../docs/cli.md) for full details.
