import * as assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { RuntimeStatus } from "../../src/BridgeOrchestrator.js";

import { WebSocketHandler } from "../../src/web/WebSocketHandler.js";

// --- Stub orchestrator that provides getStatus() ---

class StubOrchestrator {
  status: RuntimeStatus = {
    artnet: { running: true, frameCount: 0, frameCounts: {} },
    bridges: {},
  };

  getStatus(): RuntimeStatus {
    return this.status;
  }
}

function waitForMessage(ws: WebSocket, expectedType?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for message")), 4000);
    const handler = (data: unknown): void => {
      const raw = String(data);
      if (expectedType) {
        try {
          const parsed = JSON.parse(raw) as { type?: string };
          if (parsed.type !== expectedType) return; // skip non-matching messages (e.g. "artnet")
        } catch {
          return;
        }
      }
      clearTimeout(timeout);
      ws.off("message", handler);
      resolve(raw);
    };
    ws.on("message", handler);
  });
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

describe("WebSocketHandler", () => {
  let httpServer: Server;
  let wss: WebSocketServer;
  let handler: WebSocketHandler;
  let orchestrator: StubOrchestrator;
  let port: number;

  before((done) => {
    orchestrator = new StubOrchestrator();
    httpServer = createServer();
    wss = new WebSocketServer({ server: httpServer, path: "/ws" });
    // The cast-free approach: StubOrchestrator satisfies the shape that
    // WebSocketHandler needs (getStatus returning RuntimeStatus).
    handler = new WebSocketHandler(
      wss,
      orchestrator as unknown as import("../../src/BridgeOrchestrator.js").BridgeOrchestrator,
    );
    handler.start();

    httpServer.listen(0, () => {
      const addr = httpServer.address();
      if (typeof addr === "object" && addr !== null) {
        port = addr.port;
      }
      done();
    });
  });

  after(() => {
    handler.stop();
    httpServer.close();
  });

  it("subscribe then receive status updates", async () => {
    orchestrator.status.bridges["bridge-1"] = {
      connected: true,
      entityCount: 3,
      realtimeCount: 2,
      limitedCount: 1,
      rateLimitUsage: {},
      entities: {},
    };

    const ws = await connectWs(port);
    try {
      ws.send(JSON.stringify({ type: "subscribe", bridgeId: "bridge-1" }));

      const raw = await waitForMessage(ws, "status");
      const msg = JSON.parse(raw);
      assert.equal(msg.type, "status");
      assert.equal(msg.bridgeId, "bridge-1");
      assert.equal(msg.data.connected, true);
      assert.equal(msg.data.entityCount, 3);
    } finally {
      ws.close();
    }
  });

  it("unsubscribe stops receiving updates", async () => {
    orchestrator.status.bridges["bridge-2"] = {
      connected: true,
      entityCount: 1,
      realtimeCount: 0,
      limitedCount: 1,
      rateLimitUsage: {},
      entities: {},
    };

    const ws = await connectWs(port);
    try {
      ws.send(JSON.stringify({ type: "subscribe", bridgeId: "bridge-2" }));

      // Wait for first status push
      await waitForMessage(ws, "status");

      ws.send(JSON.stringify({ type: "unsubscribe", bridgeId: "bridge-2" }));

      // Wait for unsubscribe to take effect (need to cross at least one push interval)
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Now wait — should NOT receive a "status" message
      const gotStatus = await Promise.race([
        waitForMessage(ws, "status").then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 2000)),
      ]);
      assert.equal(gotStatus, false, "Should not receive status messages after unsubscribe");
    } finally {
      ws.close();
    }
  });

  it("no subscriptions means no status data pushed", async () => {
    const ws = await connectWs(port);
    try {
      // Just connect, don't subscribe — should not receive "status" messages
      // (may receive "artnet" messages which go to all clients)
      const gotStatus = await Promise.race([
        waitForMessage(ws, "status").then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 1500)),
      ]);
      assert.equal(gotStatus, false, "Should not receive status messages without subscription");
    } finally {
      ws.close();
    }
  });

  it("invalid message does not crash", async () => {
    const ws = await connectWs(port);
    try {
      ws.send("not-json");
      ws.send("{}"); // no type field
      ws.send(JSON.stringify({ type: 123 })); // wrong type for type field

      // Server should still be alive — verify by subscribing
      orchestrator.status.bridges["bridge-3"] = {
        connected: false,
        entityCount: 0,
        realtimeCount: 0,
        limitedCount: 0,
        rateLimitUsage: {},
        entities: {},
      };
      ws.send(JSON.stringify({ type: "subscribe", bridgeId: "bridge-3" }));
      const raw = await waitForMessage(ws, "status");
      const msg = JSON.parse(raw);
      assert.equal(msg.type, "status");
      assert.equal(msg.bridgeId, "bridge-3");
    } finally {
      ws.close();
    }
  });
});
