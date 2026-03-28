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

Scan the network for Hue bridges using mDNS and the Meethue discovery service.

```bash
artnet-bridge config discover
```

Output:

```
Discovering Hue bridges...
  Living Room Bridge at 192.168.1.42
  Studio Bridge at 192.168.1.55
```

### Pair

Pair with a Hue bridge. Press the link button on the bridge before running.

```bash
artnet-bridge config pair 192.168.1.42
```

Output on success:

```
Pairing with 192.168.1.42... Press the link button on your Hue bridge.
Pairing successful!
  Username: abc123...
Credentials stored. Add a bridge to your config to use them.
```

The returned credentials (`username` and `clientkey`) are used in the bridge config's `connection` field. See [Configuration](configuration.md).

## Examples

Start headless with a custom config:

```bash
artnet-bridge --config /etc/artnet-bridge/prod.json --no-web
```

Discover, pair, then run:

```bash
artnet-bridge config discover
artnet-bridge config pair 192.168.1.42
# Edit ~/.artnet-bridge/config.json to add bridge and mappings
artnet-bridge
```
