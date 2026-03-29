#!/usr/bin/env node

import { ArtNetReceiver } from "@artnet-bridge/artnet";
import { HueProtocolAdapter } from "@artnet-bridge/protocol-hue";
import { ConfigManager } from "./config/ConfigManager.js";
import { BridgeOrchestrator } from "./BridgeOrchestrator.js";
import type { ProtocolAdapterFactory } from "./BridgeOrchestrator.js";
import { WebServer } from "./web/WebServer.js";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

export interface CliArgs {
  configPath?: string;
  webPort?: number;
  noWeb: boolean;
  statsIntervalSec?: number;
  command?: string;
  commandArgs: string[];
}

export function parseArgs(args: string[]): CliArgs {
  let configPath: string | undefined;
  let webPort: number | undefined;
  let noWeb = false;
  let statsIntervalSec: number | undefined;
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
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!command && !arg.startsWith("-")) {
      command = arg;
    } else if (command) {
      commandArgs.push(arg);
    }
  }

  return { configPath, webPort, noWeb, statsIntervalSec, command, commandArgs };
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
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    process.exit(1);
  });

  const args = parseArgs(process.argv.slice(2));
  const configManager = new ConfigManager(args.configPath);

  // Handle config subcommands
  if (args.command === "config") {
    await handleConfigCommand(args.commandArgs, configManager);
    return;
  }

  // Main server mode
  const config = configManager.load();

  // Set up protocol adapter factories
  const adapterFactories = new Map<string, ProtocolAdapterFactory>();
  adapterFactories.set("hue", (bridgeConfig) => {
    const conn = bridgeConfig.connection;
    const host = typeof conn.host === "string" ? conn.host : "";
    const username = typeof conn.username === "string" ? conn.username : "";
    const clientkey = typeof conn.clientkey === "string" ? conn.clientkey : "";
    const protocolConfig = bridgeConfig.protocolConfig ?? {};
    const entertainmentConfigId =
      typeof protocolConfig.entertainmentConfigId === "string"
        ? protocolConfig.entertainmentConfigId
        : undefined;

    return new HueProtocolAdapter({
      bridges: [
        {
          id: bridgeConfig.id,
          name: bridgeConfig.name,
          connection: { host, username, clientkey },
          entertainmentConfigId,
        },
      ],
    });
  });

  // Create ArtNet receiver
  const artnet = new ArtNetReceiver({
    bindAddress: config.artnet.bindAddress,
    port: config.artnet.port,
  });

  // Create orchestrator
  const statsOpts =
    args.statsIntervalSec !== undefined ? { statsIntervalSec: args.statsIntervalSec } : undefined;
  const orchestrator = new BridgeOrchestrator(config, artnet, adapterFactories, statsOpts);

  const webPort = args.webPort ?? config.web.port;
  const webEnabled = !args.noWeb && config.web.enabled;
  let webServer: WebServer | undefined;

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutting down...");
    try {
      await webServer?.stop();
    } catch (e) {
      console.error("Web server stop error:", e);
    }
    try {
      await orchestrator.stop();
    } catch (e) {
      console.error("Orchestrator stop error:", e);
    }
    process.exit(0);
  };
  process.on("SIGINT", () => {
    shutdown().catch((err) => {
      console.error("Shutdown error:", err);
      process.exit(1);
    });
  });
  process.on("SIGTERM", () => {
    shutdown().catch((err) => {
      console.error("Shutdown error:", err);
      process.exit(1);
    });
  });

  // Start
  try {
    await orchestrator.start();
    console.log(
      `ArtNet Bridge started (listening on ${config.artnet.bindAddress}:${config.artnet.port})`,
    );

    // Create web server after orchestrator.start() so adapters are available
    if (webEnabled) {
      webServer = new WebServer({
        port: webPort,
        orchestrator,
        configManager,
        adapters: orchestrator.getAdapters(),
      });
      await webServer.start();
      console.log(`Web UI available at http://localhost:${webPort}`);
    }
  } catch (error) {
    console.error("Failed to start:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Config subcommands
// ---------------------------------------------------------------------------

const SUPPORTED_PROTOCOLS = ["hue"];

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

async function handleConfigCommand(args: string[], configManager: ConfigManager): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "discover") {
    const protocol = args[1];
    if (!protocol) {
      console.error("Usage: artnet-bridge config discover <protocol>");
      console.error(`Supported protocols: ${SUPPORTED_PROTOCOLS.join(", ")}`);
      process.exit(1);
    }
    await handleDiscover(protocol);
  } else if (subcommand === "pair") {
    const protocol = args[1];
    const host = args[2];
    if (!protocol || !host) {
      console.error("Usage: artnet-bridge config pair <protocol> <host>");
      console.error(`Supported protocols: ${SUPPORTED_PROTOCOLS.join(", ")}`);
      process.exit(1);
    }
    await handlePair(protocol, host, configManager);
  } else if (subcommand === "set") {
    const key = args[1];
    const rawValue = args[2];
    if (!key || rawValue === undefined) {
      console.error("Usage: artnet-bridge config set <key> <value>");
      console.error("Examples:");
      console.error("  artnet-bridge config set artnet.port 6454");
      console.error("  artnet-bridge config set web.port 9090");
      console.error("  artnet-bridge config set bridges.0.universe 1");
      process.exit(1);
    }
    const config = configManager.load();
    const value = coerceValue(rawValue);
    setByPath(config as unknown as Record<string, unknown>, key, value);
    configManager.save(config);
    console.log(`Set ${key} = ${JSON.stringify(value)}`);
  } else if (subcommand === "get") {
    const key = args[1];
    if (!key) {
      console.error("Usage: artnet-bridge config get <key>");
      console.error("Examples:");
      console.error("  artnet-bridge config get artnet.port");
      console.error("  artnet-bridge config get bridges.0.name");
      process.exit(1);
    }
    const config = configManager.load();
    const value = getByPath(config as unknown as Record<string, unknown>, key);
    if (value === undefined) {
      console.error(`Key not found: ${key}`);
      process.exit(1);
    }
    if (typeof value === "object" && value !== null) {
      console.log(JSON.stringify(value, null, 2));
    } else {
      console.log(String(value));
    }
  } else if (subcommand === "show") {
    const config = configManager.load();
    console.log(JSON.stringify(config, null, 2));
    console.log("");
    console.log("Common settings (use 'artnet-bridge config set <key> <value>'):");
    console.log("  artnet.bindAddress   ArtNet bind address (default: 0.0.0.0)");
    console.log("  artnet.port          ArtNet UDP port (default: 6454)");
    console.log("  web.port             Web UI port (default: 8080)");
    console.log("  web.enabled          Enable web UI (default: true)");
    console.log("  bridges.N.universe   ArtNet universe for bridge N (0-based)");
    console.log("  bridges.N.name       Display name for bridge N");
  } else {
    console.error(`Unknown config subcommand: ${subcommand ?? "(none)"}`);
    console.error("Available: discover, pair, set, get, show");
    process.exit(1);
  }
}

async function handleDiscover(protocol: string): Promise<void> {
  switch (protocol) {
    case "hue": {
      const { discoverBridges } = await import("@artnet-bridge/protocol-hue");
      console.log("Discovering Hue bridges...");
      const bridges = await discoverBridges();
      if (bridges.length === 0) {
        console.log("No bridges found.");
      } else {
        for (const bridge of bridges) {
          console.log(`  ${bridge.name ?? bridge.id} at ${bridge.host}`);
        }
      }
      break;
    }
    default:
      console.error(`Unknown protocol: ${protocol}`);
      console.error(`Supported protocols: ${SUPPORTED_PROTOCOLS.join(", ")}`);
      process.exit(1);
  }
}

async function handlePair(
  protocol: string,
  host: string,
  configManager: ConfigManager,
): Promise<void> {
  switch (protocol) {
    case "hue": {
      const { pairWithBridge } = await import("@artnet-bridge/protocol-hue");
      console.log(
        `Pairing with Hue bridge at ${host}...\nPress the link button on your bridge now (waiting up to 30 seconds)...`,
      );
      const result = await pairWithBridge(host, "artnet-bridge", "default", {
        timeoutSec: 30,
        pollIntervalMs: 2000,
      });
      if (result.success && result.connection) {
        const conn = result.connection;
        if (typeof conn.username !== "string") {
          console.error("Pairing succeeded but no username was returned. Unexpected.");
          break;
        }
        const hasClientKey = typeof conn.clientkey === "string" && conn.clientkey.length > 0;

        console.log("Pairing successful!");

        // Auto-save bridge entry to config
        const bridgeId = `hue-${host.replace(/\./g, "-")}`;
        const config = configManager.load();

        if (config.bridges.some((b) => b.id === bridgeId)) {
          console.log(`Bridge ${bridgeId} already exists in config — credentials updated.`);
          const existing = config.bridges.find((b) => b.id === bridgeId);
          if (existing) {
            existing.connection = result.connection;
          }
        } else {
          config.bridges.push({
            id: bridgeId,
            name: `Hue @ ${host}`,
            protocol: "hue",
            connection: result.connection,
            universe: 0,
            channelMappings: [],
          });
          console.log(`Bridge '${bridgeId}' added to config.`);
        }
        configManager.save(config);

        console.log("\nNext steps:");
        console.log("  1. Configure ArtNet universe and channel mappings");
        if (hasClientKey) {
          console.log("  2. Optionally select an entertainment area for realtime streaming");
          console.log(`     (use the web UI at http://localhost:8080/protocol/hue/ or config set)`);
        } else {
          console.log("  Note: No client key returned — entertainment streaming unavailable.");
          console.log("  Your bridge firmware may need updating for entertainment API support.");
        }
      } else {
        console.error(`Pairing failed: ${result.error}`);
      }
      break;
    }
    default:
      console.error(`Unknown protocol: ${protocol}`);
      console.error(`Supported protocols: ${SUPPORTED_PROTOCOLS.join(", ")}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
