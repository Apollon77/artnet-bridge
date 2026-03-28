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
  artnet-bridge [options]              Start the bridge server
  artnet-bridge config discover        Discover bridges on network
  artnet-bridge config pair <host>     Pair with a bridge

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
  const shutdown = async (): Promise<void> => {
    console.log("\nShutting down...");
    await webServer?.stop();
    await orchestrator.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

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

async function handleConfigCommand(args: string[], _configManager: ConfigManager): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "discover") {
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
  } else if (subcommand === "pair") {
    const host = args[1];
    if (!host) {
      console.error("Usage: artnet-bridge config pair <host>");
      process.exit(1);
    }
    const { pairWithBridge } = await import("@artnet-bridge/protocol-hue");
    console.log(`Pairing with ${host}... Press the link button on your Hue bridge.`);
    const result = await pairWithBridge(host, "artnet-bridge", "default");
    if (result.success && result.connection) {
      const conn = result.connection;
      if (typeof conn.username === "string") {
        console.log("Pairing successful!");
        console.log(`  Username: ${conn.username}`);
        console.log("Credentials stored. Add a bridge to your config to use them.");
      }
    } else {
      console.error(`Pairing failed: ${result.error}`);
    }
  } else {
    console.error(`Unknown config subcommand: ${subcommand}`);
    console.error("Available: discover, pair");
    process.exit(1);
  }
}

void main();
