# ArtNet Bridge

ArtNet/DMX bridge to IoT lighting protocols. Control your smart lights from any ArtNet-compatible lighting console or software.

Currently supports **Philips Hue** with both realtime entertainment streaming and standard REST API control. Extensible to other protocols.

## Features

- **Realtime entertainment streaming** -- DTLS streaming to Hue Entertainment areas at 50Hz for synchronized, lag-free light control
- **Standard API control** -- rate-limited REST API for individual lights, groups (rooms/zones), and scene activation
- **Multi-bridge support** -- connect multiple Hue bridges simultaneously, each with their own ArtNet universe
- **Web UI** -- browser-based dashboard for configuration, channel mapping, live status monitoring, and debug controls
- **Partial frame support** -- accumulates partial DMX frames per universe, so controllers that send only changed channels work correctly alongside full-frame controllers
- **Extensible** -- protocol adapter interface for adding new lighting protocols (Matter, etc.)

## Installation

Requires a LTS version of Node.js, minimum **Node.js >= 22.13.0**.

```bash
npm install -g artnet-bridge
```

After installation, the `artnet-bridge` command is available globally.

## Getting Started

### 1. Discover your Hue bridges

Find Hue bridges on your local network:

```bash
artnet-bridge config discover hue
```

### 2. Pair with a bridge

**Option A: CLI**

Run the pair command -- it will wait up to 30 seconds for you to press the link button:

```bash
artnet-bridge config pair hue 192.168.1.42
```

Press the **link button** on your Hue bridge. The command polls every 2 seconds until the button is pressed or the timeout expires.

**Option B: Web UI**

If the server is already running, open `http://localhost:8080`, go to the Config section, enter the bridge IP, and click "Pair". Same 30-second window applies.

Both methods save the bridge credentials to `~/.artnet-bridge/config.json` automatically.

### 3. Configure DMX channel mappings

The easiest way is through the **web UI**:

1. Start the server: `artnet-bridge`
2. Open `http://localhost:8080`
3. Click **"Channel Mapping"** on your bridge card
4. Select the entities you want to control, choose channel modes
5. Click **"Map Selected"** to auto-assign DMX addresses
6. Click **"Save Mappings"**
7. Restart the server to apply

Alternatively, edit `~/.artnet-bridge/config.json` directly. See [Configuration Reference](../../docs/configuration.md) for the full schema.

### 4. Set up an entertainment area (optional, for realtime control)

For lag-free realtime control of up to 10 lights per bridge:

1. Open the **Philips Hue app** on your phone
2. Go to **Settings > Entertainment areas**
3. Create an entertainment area and add the lights you want to control in realtime
4. Start the server and open the **Hue Configuration** page (`/protocol/hue/`)
5. Select the entertainment area and click **Save**
6. Restart the server

If only one entertainment area exists on a bridge, it is auto-selected.

Lights in the entertainment area are controlled via DTLS streaming at up to 50Hz. These lights are automatically excluded from standard REST API control to avoid conflicts.

### 5. Start the server

```bash
artnet-bridge
```

Now point your ArtNet lighting console or software at this machine's IP address, and your Hue lights will respond to DMX channels.

### 6. Use the web UI

Open `http://localhost:8080` in your browser:

- **Bridge overview** -- connection status, entity counts per bridge
- **Show Details** -- live per-entity RGB values and dimmer %, rate limit usage, streaming stats, test controls with entity selection
- **Channel Mapping** -- assign DMX addresses to lights/groups/scenes, auto-map, validation with overlap warnings
- **Hue Configuration** (`/protocol/hue/`) -- entertainment area selection, browse lights/rooms/zones/scenes with IDs
- **Config panel** -- discover bridges, pair, edit basic settings

## DMX Channel Modes

| Mode | Channels | Description |
|------|----------|-------------|
| `8bit-dimmable` | 4 (Dim, R, G, B) | RGB with master dimmer (recommended for color lights) |
| `8bit` | 3 (R, G, B) | Standard RGB, each 0-255 |
| `16bit` | 6 (R coarse, R fine, G coarse, G fine, B coarse, B fine) | High-resolution RGB |
| `brightness` | 1 | Brightness control for white-only lights or groups, 0-255 |
| `scene-selector` | 1 | Scene activation: 0 = none, 1-255 = scene index |

## Hue Rate Limits

The Hue bridge has hardware limits on how fast it can process updates:

| Resource | Rate | Notes |
|----------|------|-------|
| Entertainment (realtime) | 50Hz streaming, ~12.5Hz visible effect rate | Via DTLS, max 10 lights per area |
| Individual lights | 10 updates/sec (shared across all lights per bridge) | 100ms gap between calls |
| Groups | 1 update/sec | Room/zone state changes |
| Scenes | 1 update/sec | Scene activations |

ArtNet Bridge enforces these limits automatically. You can configure lower limits per bridge in the config file. The web UI shows real-time rate limit usage.

## CLI Reference

```bash
artnet-bridge                                    # Start the server
artnet-bridge --config /path/to/config.json      # Custom config path
artnet-bridge --port 9090                        # Custom web UI port
artnet-bridge --no-web                           # Start without web UI
artnet-bridge --stats-interval 5                 # Stats log every 5s (0=off)
artnet-bridge config discover hue                # Find Hue bridges on network
artnet-bridge config pair hue <host>             # Pair with a Hue bridge
artnet-bridge config set <key> <value>           # Set a config value
artnet-bridge config get <key>                   # Get a config value
artnet-bridge config show                        # Show full config
```

Config set/get examples:

```bash
artnet-bridge config set artnet.port 6454
artnet-bridge config set web.port 9090
artnet-bridge config set bridges.0.universe 1
artnet-bridge config set bridges.0.name "Living Room"
```

## QLC+ Fixture Definitions

Pre-built fixture definitions for [QLC+](https://www.qlcplus.org/) are included. One fixture "Hue Light" with all 5 modes. See [fixtures/README.md](../../fixtures/README.md) for installation instructions.

## Documentation

- [Configuration Reference](../../docs/configuration.md) -- full config file format and validation rules
- [CLI Reference](../../docs/cli.md) -- all commands and flags
- [Web UI Guide](../../docs/web-ui.md) -- using the browser dashboard
- [Hue Adapter Details](../protocol-hue/README.md) -- entertainment vs REST modes, rate limits, channel modes

## Troubleshooting

**Lights don't respond to DMX:**
- Check that the bridge is connected (web UI shows green dot)
- Check that entities have DMX addresses assigned (Channel Mapping)
- Check the stats log for frame counts and dispatch activity
- For entertainment lights: check DTLS connection status

**Entertainment streaming not working:**
- Ensure an entertainment area is selected in the Hue Configuration page
- Check that `clientkey` was saved during pairing (needed for DTLS)
- The Hue bridge only allows one streaming session at a time -- close the Hue app if it's streaming

**Groups/scenes override individual lights:**
- The channel mapping editor warns about this -- if a group and its member lights are both mapped, group commands (on/off) will affect all members
- Consider mapping either the group OR individual lights, not both
