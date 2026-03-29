# ArtNet Bridge

ArtNet/DMX bridge to IoT lighting protocols. Control your smart lights from any ArtNet-compatible lighting console or software.

Currently supports **Philips Hue** with both realtime entertainment streaming and standard REST API control. Extensible to other protocols.

## Features

- **Realtime entertainment streaming** -- DTLS streaming to Hue Entertainment areas at 50Hz for synchronized, lag-free light control
- **Standard API control** -- rate-limited REST API for individual lights, groups (rooms/zones), and scene activation
- **Multi-bridge support** -- connect multiple Hue bridges simultaneously, each with their own ArtNet universe
- **Web UI** -- browser-based dashboard for configuration, live status monitoring, and debug controls
- **Extensible** -- protocol adapter interface for adding new lighting protocols (Matter, etc.)

## Installation

Requires a LTS version of Node.js, minimum **Node.js >= 22.13.0**.

```bash
npm install -g artnet-bridge
```

After installation, the `artnet-bridge` command is available globally.

> **Development setup:** If you want to build from source instead, see the [Development](#development) section below.

## Getting Started

### 1. Discover your Hue bridges

Find Hue bridges on your local network:

```bash
artnet-bridge config discover hue
```

Output:
```
Discovering Hue bridges...
  My Hue Bridge at 192.168.1.42
```

### 2. Pair with a bridge

Press the **link button** on your Hue bridge, then within 30 seconds run:

```bash
artnet-bridge config pair hue 192.168.1.42
```

This creates an API user on the bridge and saves the credentials to your config file at `~/.artnet-bridge/config.json`. The bridge is added with a default entry — you will configure the DMX mapping next.

### 3. Configure DMX channel mappings

Open `~/.artnet-bridge/config.json` in a text editor (or use the web UI). You need to map ArtNet DMX channels to your Hue lights and groups.

Each bridge entry needs:
- `universe` -- which ArtNet universe to listen on (0-based)
- `channelMappings` -- which DMX channels control which lights

Example config with two lights and a group:

```json
{
  "version": 1,
  "artnet": {
    "bindAddress": "0.0.0.0",
    "port": 6454
  },
  "web": {
    "port": 8080,
    "enabled": true
  },
  "bridges": [
    {
      "id": "hue-192.168.1.42",
      "name": "Living Room",
      "protocol": "hue",
      "connection": {
        "host": "192.168.1.42",
        "username": "your-api-username",
        "clientkey": "your-client-key"
      },
      "universe": 0,
      "channelMappings": [
        {
          "targetId": "abc123-light-id",
          "targetType": "light",
          "dmxStart": 1,
          "channelMode": "8bit"
        },
        {
          "targetId": "def456-light-id",
          "targetType": "light",
          "dmxStart": 4,
          "channelMode": "8bit"
        },
        {
          "targetId": "grouped-light-id",
          "targetType": "group",
          "dmxStart": 7,
          "channelMode": "brightness"
        }
      ],
      "protocolConfig": {
        "entertainmentConfigId": "entertainment-area-uuid"
      }
    }
  ]
}
```

To find your light and group IDs, start the server and use the web UI, or check your Hue bridge's API directly.

### 4. Set up an entertainment area (optional, for realtime control)

For lag-free realtime control of up to 10 lights per bridge:

1. Open the **Philips Hue app** on your phone
2. Go to **Settings > Entertainment areas**
3. Create an entertainment area and add the lights you want to control in realtime
4. Note the entertainment area UUID (visible in the web UI after starting the server)
5. Add it to your config as `protocolConfig.entertainmentConfigId`

Lights in the entertainment area are controlled via DTLS streaming at up to 50Hz. These lights are automatically excluded from standard REST API control to avoid conflicts.

All other lights on the bridge are controlled via the standard REST API with rate limiting.

### 5. Start the server

```bash
artnet-bridge
```

Output:
```
ArtNet Bridge started (listening on 0.0.0.0:6454)
Web UI available at http://localhost:8080
```

Now point your ArtNet lighting console or software at this machine's IP address, and your Hue lights will respond to DMX channels.

### 6. Use the web UI

Open `http://localhost:8080` in your browser. The web UI shows:

- **Compact view** -- all bridges with connection status and entity counts
- **Detail panels** -- click a bridge to see live per-light RGB values, rate limit usage, and streaming stats
- **Config** -- discover bridges, pair, edit settings
- **Test controls** -- send solid colors to lights for debugging (no ArtNet source needed)

## DMX Channel Modes

| Mode | Channels | Description |
|------|----------|-------------|
| `8bit` | 3 (R, G, B) | Standard RGB, each 0-255 |
| `8bit-dimmable` | 4 (Dim, R, G, B) | RGB with master dimmer |
| `16bit` | 6 (R coarse, R fine, G coarse, G fine, B coarse, B fine) | High-resolution RGB |
| `brightness` | 1 | Group brightness control, 0-255 |
| `scene-selector` | 1 | Scene activation: 0 = none, 1-255 = scene index |

## Hue Rate Limits

The Hue bridge has hardware limits on how fast it can process updates:

| Resource | Rate | Notes |
|----------|------|-------|
| Entertainment (realtime) | 50Hz streaming, ~12.5Hz visible effect rate | Via DTLS, max 10 lights per area |
| Individual lights | 10 updates/sec (shared across all lights per bridge) | 100ms gap between calls |
| Groups | 1 update/sec | Room/zone state changes |
| Scenes | 1 update/sec | Scene activations |

ArtNet Bridge enforces these limits automatically. You can configure lower limits per bridge in the config file.

## CLI Reference

```bash
artnet-bridge                        # Start the server
artnet-bridge --config /path/to/config.json   # Custom config path
artnet-bridge --port 9090            # Custom web UI port
artnet-bridge --no-web               # Start without web UI
artnet-bridge config discover hue        # Find Hue bridges on network
artnet-bridge config pair hue <host>     # Pair with a Hue bridge
```

See [CLI documentation](docs/cli.md) for full details.

## Documentation

**User guides:**
- [Configuration Reference](docs/configuration.md) -- full config file format, all options, validation rules
- [CLI Reference](docs/cli.md) -- all commands and flags
- [Web UI Guide](docs/web-ui.md) -- using the browser dashboard

**Lighting software:**
- [QLC+ Fixture Definitions](fixtures/README.md) -- pre-built fixtures for QLC+

**Developer guides:**
- [Developing Protocol Adapters](docs/developing-protocols.md) -- how to add support for new protocols
- [packages/artnet](packages/artnet/README.md) -- ArtNet protocol implementation
- [packages/protocol](packages/protocol/README.md) -- base types and adapter interface
- [packages/protocol-hue](packages/protocol-hue/README.md) -- Philips Hue adapter details
- [packages/bridge](packages/bridge/README.md) -- main application architecture

## Architecture

```
packages/
  artnet/             @artnet-bridge/artnet        ArtNet UDP protocol (0 deps)
  protocol/           @artnet-bridge/protocol      Base types and interfaces (0 deps)
  protocol-hue/       @artnet-bridge/protocol-hue  Philips Hue adapter
  bridge/             artnet-bridge                Main application
  tools/              @artnet-bridge/tools         Build tooling (internal)
```

## Development

To build and run from source:

```bash
git clone https://github.com/Apollon77/artnet-bridge.git
cd artnet-bridge
npm install
npm run build
```

Run the server from the source checkout:

```bash
npm run server                              # Start the bridge
npm run server -- --port 9090               # Custom web UI port
npm run server -- config discover           # Discover bridges
npm run server -- config pair 192.168.1.42  # Pair with a bridge
```

Other development commands:

```bash
npm run build-clean    # Clean + build
npm test               # Run tests
npm run lint           # Lint with oxlint
npm run format         # Format with oxfmt
npm run format-verify  # Check formatting (CI)
```

ESM-only monorepo using npm workspaces. TypeScript with project references, esbuild for transpilation.

## QLC+ Fixture Definitions

Pre-built fixture definitions for [QLC+](https://www.qlcplus.org/) are included in the [`fixtures/`](fixtures/) directory, covering all channel modes (8bit RGB, 8bit+Dimmer, 16bit RGB, Brightness, Scene Selector). See the [fixtures README](fixtures/README.md) for installation instructions.

## Inspired By

This project was inspired by and builds upon ideas from these projects:

- **[artnet-hue-entertainment](https://github.com/jundl77/artnet-hue-entertainment)** -- ArtNet to Hue Entertainment API bridge with DTLS streaming support and web UI. The entertainment streaming approach, DTLS packet format, and web-based configuration pattern were key references.
- **[dmx-hue](https://github.com/sinedied/dmx-hue)** -- ArtNet to Hue bridge using the standard REST API with rate limiting. The DMX channel mapping model and rate-limited update approach were valuable references.
- **[node-hue-api](https://github.com/peter-murray/node-hue-api)** -- Comprehensive Node.js client for the Philips Hue API. Used as API surface reference for understanding the Hue CLIP v2 resource model (lights, groups, scenes, entertainment configurations).

## License

MIT
