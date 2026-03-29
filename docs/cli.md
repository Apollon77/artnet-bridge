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

### Set

Set a configuration value using dot-notation path. Values are auto-coerced: `"true"`/`"false"` become booleans, numeric strings become numbers, everything else stays a string.

```bash
artnet-bridge config set <key> <value>
```

Examples:

```bash
artnet-bridge config set artnet.bindAddress 192.168.1.5
artnet-bridge config set artnet.port 6454
artnet-bridge config set web.port 9090
artnet-bridge config set web.enabled false
artnet-bridge config set bridges.0.universe 1
artnet-bridge config set bridges.0.name "Living Room"
```

The config is validated after setting the value. If the resulting config is invalid, the change is rejected and an error is printed.

### Get

Read a single configuration value using dot-notation path. Objects and arrays are printed as pretty-printed JSON; scalars are printed as plain text.

```bash
artnet-bridge config get <key>
```

Examples:

```bash
artnet-bridge config get artnet.port       # prints: 6454
artnet-bridge config get web.enabled       # prints: true
artnet-bridge config get bridges.0.name    # prints: Living Room
artnet-bridge config get artnet            # prints the full artnet section as JSON
```

Exits with code 1 if the key is not found.

### Show

Print the entire current config as pretty-printed JSON.

```bash
artnet-bridge config show
```

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
