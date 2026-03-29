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
  command?: string;
  commandArgs: string[];
}

export function parseArgs(args: string[]): CliArgs {
  let configPath: string | undefined;
  let webPort: number | undefined;
  let noWeb = false;
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
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!command && !arg.startsWith("-")) {
      command = arg;
    } else if (command) {
      commandArgs.push(arg);
    }
  }

  return { configPath, webPort, noWeb, command, commandArgs };
}

function printHelp(): void {
  console.log(`
artnet-bridge - ArtNet/DMX bridge to IoT lighting protocols

Usage:
  artnet-bridge [options]                     Start the bridge server
  artnet-bridge config discover <protocol>    Discover bridges (e.g. hue)
  artnet-bridge config pair <protocol> <host> Pair with a bridge

Supported protocols: hue

Options:
  --config <path>   Config file path (default: ~/.artnet-bridge/config.json)
  --port <number>   Web UI port (default: 8080)
  --no-web          Disable web UI
  -h, --help        Show this help
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
  const orchestrator = new BridgeOrchestrator(config, artnet, adapterFactories);

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
  } else {
    console.error(`Unknown config subcommand: ${subcommand ?? "(none)"}`);
    console.error("Available: discover, pair");
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
      console.log(`Pairing with Hue bridge at ${host}... Press the link button now.`);
      const result = await pairWithBridge(host, "artnet-bridge", "default");
      if (result.success && result.connection) {
        const conn = result.connection;
        if (typeof conn.username === "string") {
          console.log("Pairing successful!");

          // Auto-save bridge entry to config
          const bridgeId = `hue-${host.replace(/\./g, "-")}`;
          const config = configManager.load();

          if (config.bridges.some((b) => b.id === bridgeId)) {
            console.log(`Bridge ${bridgeId} already exists in config — skipping auto-add.`);
          } else {
            config.bridges.push({
              id: bridgeId,
              name: `Hue @ ${host}`,
              protocol: "hue",
              connection: result.connection,
              universe: 0,
              channelMappings: [],
            });
            configManager.save(config);
            console.log(`Bridge '${bridgeId}' added to config.`);
            console.log("Configure universe and channel mappings to start using it.");
          }
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
