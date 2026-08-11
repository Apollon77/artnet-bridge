# CLI Usage

## Starting the Server

```bash
artnet-bridge                              # start with defaults
artnet-bridge --config /path/config.json   # custom config file
artnet-bridge --port 9090                  # custom web UI port
artnet-bridge --no-web                     # headless mode (no web UI)
artnet-bridge --debug-artnet               # log every incoming Art-Net packet
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
| `--stats-interval <seconds>` | Stats log interval, `0` disables it | `10` |
| `--debug-artnet` | Log every incoming Art-Net packet (also `ARTNET_DEBUG=1`) | off |
| `-h`, `--help` | Show help and exit | |

Unknown flags are rejected with exit code 1.

## Debugging Incoming Art-Net

`--debug-artnet` logs every datagram the receiver sees, including ones the parser rejects (normally dropped silently). Detail lines are throttled to one per second per source and universe; a per-source summary is printed every 2 seconds, and an explicit line is printed when nothing arrived at all.

```bash
artnet-bridge --debug-artnet
ARTNET_DEBUG=1 artnet-bridge          # same, via environment
npm run server -- --debug-artnet      # from the monorepo
```

```
[ArtNet:debug] Traffic logging enabled — configured universes: 0
[ArtNet:debug] OpPoll from 192.168.40.2:52914 protocol version 14 flags 0x02 (reply-on-change)
[ArtNet:debug] OpPollReply sent to 192.168.40.2:6454 and broadcast — advertising universes 0
[ArtNet:debug] OpDmx from 192.168.40.2:6454 universe 0 seq 37 phys 0 512 channels [ch1-12: 255 128 64 0 0 0 0 0 0 0 0 0]
[ArtNet:debug] 192.168.40.2: 88 packets (44/s) [OpDmx 88] universes 0
[ArtNet:debug] No Art-Net traffic received in the last 2000ms
```

| Line | Meaning |
|------|---------|
| `No Art-Net traffic received` | Nothing reaches the bridge — check the console's target address, the network interface, and UDP port 6454 |
| `universe NOT configured` | DMX arrives on a universe no bridge is mapped to |
| `Dropped datagram … <reason>` | Malformed packet or an opcode this bridge does not handle; reason plus the first bytes are printed |
| `OpPollReply sent … advertising universes` | What this bridge announces during discovery |
| `OpPollReply from …` | Another Art-Net node on the network announced itself |

Independent of this flag, the bridge warns at startup when no channel mappings are configured, and logs the first DMX frame per universe with its first 8 channel values.

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
