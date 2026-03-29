import express from "express";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { ProtocolAdapter } from "@artnet-bridge/protocol";
import type { BridgeOrchestrator } from "../BridgeOrchestrator.js";
import type { ConfigManager } from "../config/ConfigManager.js";
import { WebSocketHandler } from "./WebSocketHandler.js";
import { createConfigRoutes } from "./routes/configRoutes.js";
import { createStatusRoutes } from "./routes/statusRoutes.js";
import { createBridgeRoutes } from "./routes/bridgeRoutes.js";

const defaultStaticPath = join(dirname(fileURLToPath(import.meta.url)), "public");

export interface WebServerOptions {
  port: number;
  staticPath?: string;
  orchestrator: BridgeOrchestrator;
  configManager: ConfigManager;
  adapters: ProtocolAdapter[];
}

export class WebServer {
  private readonly app: express.Application;
  private readonly httpServer: Server;
  private readonly wss: WebSocketServer;
  private readonly wsHandler: WebSocketHandler;
  private readonly port: number;

  constructor(options: WebServerOptions) {
    this.port = options.port;
    this.app = express();

    // Parse JSON bodies globally for API routes
    this.app.use("/api", express.json());

    // Static file serving
    const staticDir = options.staticPath ?? defaultStaticPath;
    this.app.use(express.static(staticDir));

    // REST API routes
    this.app.use("/api/config", createConfigRoutes(options.configManager));
    this.app.use("/api/status", createStatusRoutes(options.orchestrator));
    this.app.use(
      "/api/bridges",
      createBridgeRoutes(options.adapters, options.configManager, options.orchestrator),
    );

    // Protocol adapter routes
    for (const adapter of options.adapters) {
      if (adapter.registerWebHandlers) {
        const protocolRouter = express.Router();
        adapter.registerWebHandlers(protocolRouter);
        this.app.use(`/protocol/${adapter.type}`, protocolRouter);
      }
    }

    // Create HTTP server from Express app
    this.httpServer = createServer(this.app);

    // WebSocket server attached to the HTTP server
    this.wss = new WebSocketServer({ server: this.httpServer, path: "/ws" });
    this.wss.on("error", (err) => console.error("WebSocket server error:", err));
    this.wsHandler = new WebSocketHandler(this.wss, options.orchestrator);
  }

  async start(): Promise<void> {
    this.wsHandler.start();

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      this.httpServer.listen(this.port, () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });

      this.httpServer.on("error", (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  }

  async stop(): Promise<void> {
    this.wsHandler.stop();

    return new Promise<void>((resolve) => {
      this.httpServer.close((err) => {
        if (err) {
          console.error("HTTP server close error:", err);
        }
        resolve();
      });
    });
  }

  /** The port the server is listening on. Useful when port 0 is used. */
  get address(): { port: number } | undefined {
    const addr = this.httpServer.address();
    if (typeof addr === "object" && addr !== null) {
      return { port: addr.port };
    }
    return undefined;
  }
}
