# ArtNet Bridge

ArtNet/DMX bridge to IoT lighting protocols. Control your smart lights from any ArtNet-compatible lighting console or software.

Currently supports **Philips Hue** with both realtime entertainment streaming and standard REST API control. Extensible to other protocols.

**For installation and usage instructions, see the [artnet-bridge package README](packages/bridge/README.md).**

## Quick Start

```bash
npm install -g artnet-bridge
artnet-bridge config discover hue
artnet-bridge config pair hue <bridge-ip>
artnet-bridge
```

Then open `http://localhost:8080` to configure channel mappings and monitor live status.

## Monorepo Structure

This project is organized as an npm workspaces monorepo with 5 packages:

```
packages/
  bridge/             artnet-bridge                Main application (user-facing)
  protocol-hue/       @artnet-bridge/protocol-hue  Philips Hue adapter
  artnet/             @artnet-bridge/artnet        ArtNet UDP protocol (0 external deps)
  protocol/           @artnet-bridge/protocol      Base types and interfaces (0 deps)
  tools/              @artnet-bridge/tools         Build tooling (internal, not published)
```

### Dependency Graph (no cycles)

```
artnet-bridge
  +-- @artnet-bridge/artnet
  +-- @artnet-bridge/protocol
  +-- @artnet-bridge/protocol-hue
  |     +-- @artnet-bridge/protocol
  |     +-- node-dtls-client
  +-- express, ws
```

### Package Responsibilities

| Package | Purpose |
|---------|---------|
| [artnet-bridge](packages/bridge/README.md) | Main app: CLI, web UI, config, orchestration, rate-limited dispatch |
| [@artnet-bridge/protocol-hue](packages/protocol-hue/README.md) | Hue adapter: CLIP v2 client, DTLS streaming, discovery, pairing |
| [@artnet-bridge/artnet](packages/artnet/README.md) | ArtNet protocol: own UDP receiver/sender from the Art-Net 4 spec |
| [@artnet-bridge/protocol](packages/protocol/README.md) | Base types: ProtocolAdapter interface, Entity model, DMX mapping |

## Documentation

**User guides:**
- [Getting Started & Usage](packages/bridge/README.md) -- installation, setup, channel mapping, web UI
- [Configuration Reference](docs/configuration.md) -- full config file format and validation rules
- [CLI Reference](docs/cli.md) -- all commands and flags
- [Web UI Guide](docs/web-ui.md) -- using the browser dashboard

**Lighting software:**
- [QLC+ Fixture Definitions](fixtures/README.md) -- pre-built fixtures for QLC+

**Developer guides:**
- [Developing Protocol Adapters](docs/developing-protocols.md) -- how to add support for new protocols
- Package-specific READMEs linked above

## Development

To build and run from source:

```bash
git clone https://github.com/Apollon77/artnet-bridge.git
cd artnet-bridge
npm install
npm run build
```

Run the server from source:

```bash
npm run server                              # Start the bridge
npm run server -- --port 9090               # Custom web UI port
npm run server -- config discover hue       # Discover bridges
npm run server -- config pair hue <ip>      # Pair with a bridge
```

### Build Commands

```bash
npm run build          # Build all packages
npm run build-clean    # Clean + build
npm test               # Run tests
npm run lint           # Lint with oxlint
npm run format         # Format with oxfmt
npm run format-verify  # Check formatting (CI)
```

### Tooling

- **TypeScript** with composite project references, esbuild for transpilation, tsc for type-checking
- **oxlint** for linting (type-aware), **oxfmt** for formatting
- **Mocha** for testing
- **Express 5** for web server, **ws** for WebSocket
- ESM-only, Node.js >= 22.13.0

## Inspired By

This project was inspired by and builds upon ideas from these projects:

- **[artnet-hue-entertainment](https://github.com/jundl77/artnet-hue-entertainment)** -- ArtNet to Hue Entertainment API bridge with DTLS streaming support and web UI
- **[dmx-hue](https://github.com/sinedied/dmx-hue)** -- ArtNet to Hue bridge using the standard REST API with rate limiting
- **[node-hue-api](https://github.com/peter-murray/node-hue-api)** -- Comprehensive Node.js client for the Philips Hue API

## License

MIT
