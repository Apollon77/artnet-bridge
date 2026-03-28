import type { WebSocket, WebSocketServer } from "ws";
import type { BridgeOrchestrator } from "../BridgeOrchestrator.js";

const KNOWN_MESSAGE_TYPES = new Set(["subscribe", "unsubscribe"]);

interface WsMessage {
  type: "subscribe" | "unsubscribe";
  bridgeId?: string;
}

export class WebSocketHandler {
  private readonly subscriptions = new Map<WebSocket, Set<string>>();
  private statusInterval?: ReturnType<typeof setInterval>;

  constructor(
    private readonly wss: WebSocketServer,
    private readonly orchestrator: BridgeOrchestrator,
  ) {
    wss.on("connection", (ws) => this.handleConnection(ws));
  }

  start(): void {
    this.statusInterval = setInterval(() => this.pushUpdates(), 500);
  }

  stop(): void {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = undefined;
    }
    for (const ws of this.wss.clients) {
      ws.close();
    }
  }

  private handleConnection(ws: WebSocket): void {
    this.subscriptions.set(ws, new Set());

    ws.on("message", (data) => {
      this.handleMessage(ws, String(data));
    });

    ws.on("close", () => {
      this.subscriptions.delete(ws);
    });
  }

  private handleMessage(ws: WebSocket, raw: string): void {
    const msg = parseWsMessage(raw);
    if (!msg) return;

    const subs = this.subscriptions.get(ws);
    if (!subs) return;

    switch (msg.type) {
      case "subscribe":
        if (msg.bridgeId) subs.add(msg.bridgeId);
        break;
      case "unsubscribe":
        if (msg.bridgeId) subs.delete(msg.bridgeId);
        break;
    }
  }

  private pushUpdates(): void {
    const status = this.orchestrator.getStatus();

    // Send global ArtNet status to ALL connected clients
    const artnetPayload = JSON.stringify({ type: "artnet", data: status.artnet });
    for (const ws of this.wss.clients) {
      if (ws.readyState !== 1) continue; // 1 = OPEN
      ws.send(artnetPayload);
    }

    // Send per-bridge status to subscribers
    for (const [ws, bridgeIds] of this.subscriptions) {
      if (bridgeIds.size === 0) continue;
      if (ws.readyState !== 1) continue; // 1 = OPEN
      for (const bridgeId of bridgeIds) {
        const bridgeStatus = status.bridges[bridgeId];
        if (bridgeStatus) {
          ws.send(JSON.stringify({ type: "status", bridgeId, data: bridgeStatus }));
        }
      }
    }
  }
}

function parseWsMessage(raw: string): WsMessage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (typeof parsed["type"] !== "string") return undefined;
  if (!KNOWN_MESSAGE_TYPES.has(parsed["type"])) return undefined;

  const type = parsed["type"] as "subscribe" | "unsubscribe";
  const result: WsMessage = { type };

  if (typeof parsed["bridgeId"] === "string" && parsed["bridgeId"].length > 0) {
    result.bridgeId = parsed["bridgeId"];
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
