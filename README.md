# ArtNet Bridge

ArtNet/DMX bridge to IoT lighting protocols with realtime entertainment streaming and rate-limited REST control.

## Features

- **Multi-bridge support** -- connect multiple Hue bridges (or other protocols) simultaneously
- **Entertainment streaming** -- realtime DTLS streaming to Hue Entertainment areas at 50Hz
- **Standard API control** -- rate-limited REST API for lights, groups, and scenes
- **Web UI** -- dark-themed dashboard with live status, per-bridge detail panels, and config editing
- **Extensible** -- protocol adapter interface for adding new lighting protocols (Matter, etc.)

## Quick Start

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Discover Hue bridges on your network
npm run server -- config discover

# Pair with a bridge (press the link button first)
npm run server -- config pair <bridge-ip>

# Start the bridge server
npm run server
```

The web UI is available at `http://localhost:8080` by default.

### Map DMX Channels

Edit `~/.artnet-bridge/config.json` to add channel mappings. Each mapping assigns a range of DMX channels to a light, group, or scene selector. See [Configuration](docs/configuration.md) for the full schema.

```json
{
  "channelMappings": [
    { "targetId": "light-1", "targetType": "light", "dmxStart": 1, "channelMode": "8bit" },
    { "targetId": "group-1", "targetType": "group", "dmxStart": 4, "channelMode": "brightness" }
  ]
}
```

## Architecture

```
packages/
  tools/              Internal build tooling (not published)
  artnet/             @artnet-bridge/artnet      -- ArtNet UDP protocol
  protocol/           @artnet-bridge/protocol    -- Base types and interfaces
  protocol-hue/       @artnet-bridge/protocol-hue -- Philips Hue adapter
  bridge/             artnet-bridge              -- Main application
```

Dependency graph (no cycles):

```
artnet-bridge (bridge/)
  +-- @artnet-bridge/artnet
  +-- @artnet-bridge/protocol
  +-- @artnet-bridge/protocol-hue
        +-- @artnet-bridge/protocol
        +-- node-dtls-client
```

## Documentation

- [CLI Usage](docs/cli.md)
- [Configuration](docs/configuration.md)
- [Web UI](docs/web-ui.md)
- [Developing Protocol Adapters](docs/developing-protocols.md)

### Package Documentation

- [packages/artnet](packages/artnet/README.md) -- ArtNet protocol implementation
- [packages/protocol](packages/protocol/README.md) -- Base types and adapter interface
- [packages/protocol-hue](packages/protocol-hue/README.md) -- Philips Hue adapter
- [packages/bridge](packages/bridge/README.md) -- Main application

## Development

```bash
# Build all packages
npm run build

# Clean build
npm run build-clean

# Run tests
npm test

# Lint
npm run lint

# Format
npm run format

# Format check (CI)
npm run format-verify
```

Requires Node.js >= 22.13.0. ESM-only monorepo using npm workspaces.

Tooling: TypeScript with project references, esbuild for transpilation, oxlint for linting, oxfmt for formatting, Rollup for web UI bundling.

## License

MIT
