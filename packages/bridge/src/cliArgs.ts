// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

export interface CliArgs {
  configPath?: string;
  webPort?: number;
  noWeb: boolean;
  statsIntervalSec?: number;
  debugArtnet: boolean;
  command?: string;
  commandArgs: string[];
}

export function parseArgs(args: string[]): CliArgs {
  let configPath: string | undefined;
  let webPort: number | undefined;
  let noWeb = false;
  let statsIntervalSec: number | undefined;
  let debugArtnet = process.env.ARTNET_DEBUG === "1" || process.env.ARTNET_DEBUG === "true";
  let command: string | undefined;
  const commandArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config" && args[i + 1]) {
      configPath = args[++i];
    } else if (arg === "--port" && args[i + 1]) {
      webPort = parseInt(args[++i], 10);
    } else if (arg === "--no-web") {
      noWeb = true;
    } else if (arg === "--stats-interval" && args[i + 1]) {
      statsIntervalSec = parseInt(args[++i], 10);
    } else if (arg === "--debug-artnet") {
      debugArtnet = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!command && arg.startsWith("-")) {
      console.error(`Unknown option: ${arg}`);
      console.error("Run with --help to see available options.");
      process.exit(1);
    } else if (!command && !arg.startsWith("-")) {
      command = arg;
    } else if (command) {
      commandArgs.push(arg);
    }
  }

  return { configPath, webPort, noWeb, statsIntervalSec, debugArtnet, command, commandArgs };
}

function printHelp(): void {
  console.log(`
artnet-bridge - ArtNet/DMX bridge to IoT lighting protocols

Usage:
  artnet-bridge [options]                     Start the bridge server
  artnet-bridge config discover <protocol>    Discover bridges (e.g. hue)
  artnet-bridge config pair <protocol> <host> Pair with a bridge
  artnet-bridge config set <key> <value>      Set a config value (dot-notation)
  artnet-bridge config get <key>              Get a config value (dot-notation)
  artnet-bridge config show                   Show full config (pretty-printed)

Supported protocols: hue

Options:
  --config <path>            Config file path (default: ~/.artnet-bridge/config.json)
  --port <number>            Web UI port (default: 8080)
  --no-web                   Disable web UI
  --stats-interval <seconds> Stats log interval (default: 10, 0 = disabled)
  --debug-artnet             Log every incoming Art-Net packet (also: ARTNET_DEBUG=1)
  -h, --help                 Show this help

Config set examples:
  artnet-bridge config set artnet.port 6454
  artnet-bridge config set web.port 9090
  artnet-bridge config set web.enabled false
  artnet-bridge config set bridges.0.universe 1
  artnet-bridge config set bridges.0.name "Living Room"
`);
}

// ---------------------------------------------------------------------------
// Dot-notation config helpers
// ---------------------------------------------------------------------------

/** Auto-coerce a string value: "true"/"false" -> boolean, numeric strings -> number, rest -> string. */
export function coerceValue(raw: string): string | number | boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw !== "" && isFinite(Number(raw))) return Number(raw);
  return raw;
}

/** Set a value in a nested object using a dot-notation path (e.g. "bridges.0.universe"). */
export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const nextKey = parts[i + 1];
    const nextIsIndex = nextKey !== undefined && nextKey !== "" && isFinite(Number(nextKey));

    if (!(key in current) || typeof current[key] !== "object" || current[key] === null) {
      current[key] = nextIsIndex ? [] : {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = parts[parts.length - 1];
  current[lastKey] = value;
}

/** Get a value from a nested object using a dot-notation path. Returns undefined if not found. */
export function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const key of parts) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}
