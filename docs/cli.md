# CLI Usage

## Starting the Server

```bash
artnet-bridge                              # start with defaults
artnet-bridge --config /path/config.json   # custom config file
artnet-bridge --port 9090                  # custom web UI port
artnet-bridge --no-web                     # headless mode (no web UI)
```

When running from the monorepo:

```bash
npm run server                             # start with defaults
npm run server -- --port 9090              # pass flags after --
npm run server -- --no-web
```

## Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--config <path>` | Path to config file | `~/.artnet-bridge/config.json` |
| `--port <number>` | Web UI port (overrides config) | `8080` |
| `--no-web` | Disable the web UI entirely | off |
| `-h`, `--help` | Show help and exit | |

## Config Subcommands

Config subcommands perform one-time operations and exit. They do not start the server.

### Discover

Scan the network for bridges of a given protocol. The protocol name is required since each protocol uses different discovery mechanisms.

```bash
artnet-bridge config discover hue
```

Output:

```
Discovering Hue bridges...
  Living Room Bridge at 192.168.1.42
  Studio Bridge at 192.168.1.55
```

Supported protocols: `hue`

### Pair

Pair with a bridge. The protocol name and host address are required. For Hue, press the link button on the bridge before running.

```bash
artnet-bridge config pair hue 192.168.1.42
```

Output on success:

```
Pairing with Hue bridge at 192.168.1.42... Press the link button now.
Pairing successful!
Bridge 'hue-192-168-1-42' added to config.
Configure universe and channel mappings to start using it.
```

The bridge is automatically saved to the config file with default settings. You still need to configure the ArtNet universe and DMX channel mappings. See [Configuration](configuration.md).

Supported protocols: `hue`

## Examples

Start headless with a custom config:

```bash
artnet-bridge --config /etc/artnet-bridge/prod.json --no-web
```

Discover, pair, then run:

```bash
artnet-bridge config discover hue
artnet-bridge config pair hue 192.168.1.42
# Edit ~/.artnet-bridge/config.json to configure universe and channel mappings
artnet-bridge
```
