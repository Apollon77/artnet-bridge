import * as assert from "node:assert/strict";
import { ArtNetReceiver } from "@artnet-bridge/artnet";
import type {
  ProtocolAdapter,
  ProtocolBridge,
  EntityUpdate,
  EntityValue,
  DiscoveredBridge,
  PairingResult,
  AdapterStatus,
} from "@artnet-bridge/protocol";
import type { AppConfig } from "../../src/config/ConfigSchema.js";
import { CURRENT_CONFIG_VERSION } from "../../src/config/ConfigSchema.js";
import { ConfigManager } from "../../src/config/ConfigManager.js";
import { BridgeOrchestrator } from "../../src/BridgeOrchestrator.js";
import { WebServer } from "../../src/web/WebServer.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

// --- Test helpers ---

function makeTestConfig(): AppConfig {
  return {
    version: CURRENT_CONFIG_VERSION,
    artnet: { bindAddress: "127.0.0.1", port: 6454 },
    web: { port: 0, enabled: true },
    bridges: [],
  };
}

class StubAdapter implements ProtocolAdapter {
  readonly id = "stub-adapter";
  readonly name = "Stub";
  readonly type = "stub";

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async discover(): Promise<DiscoveredBridge[]> {
    return [{ id: "disc-1", host: "192.168.1.1", protocol: "stub", metadata: {} }];
  }
  async pair(_target: DiscoveredBridge): Promise<PairingResult> {
    return { success: true, connection: { key: "test-key" } };
  }
  async getBridges(): Promise<ProtocolBridge[]> {
    return [];
  }
  async handleRealtimeUpdate(_bridgeId: string, _updates: EntityUpdate[]): Promise<void> {}
  async handleLimitedUpdate(
    _bridgeId: string,
    _entityId: string,
    _value: EntityValue,
  ): Promise<void> {}
  getStatus(): AdapterStatus {
    return { connected: true, bridges: {} };
  }
}

describe("WebServer", () => {
  let server: WebServer;
  let baseUrl: string;
  let tmpDir: string;
  let configManager: ConfigManager;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "webserver-test-"));
    const configPath = join(tmpDir, "config.json");
    configManager = new ConfigManager(configPath);

    const config = makeTestConfig();
    const artnet = new ArtNetReceiver({ bindAddress: "127.0.0.1", port: 0 });
    const factories = new Map();
    const orchestrator = new BridgeOrchestrator(config, artnet, factories);

    const adapter = new StubAdapter();

    server = new WebServer({
      port: 0, // ephemeral port
      orchestrator,
      configManager,
      adapters: [adapter],
    });

    await server.start();
    const addr = server.address;
    assert.ok(addr, "Server should have an address after start");
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await server.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET /api/config returns config", async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.version, CURRENT_CONFIG_VERSION);
  });

  it("PUT /api/config with valid config saves it", async () => {
    const config = makeTestConfig();
    const res = await fetch(`${baseUrl}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
  });

  it("PUT /api/config with invalid config returns 400", async () => {
    const badConfig = { version: 999, artnet: {}, web: {}, bridges: [] };
    const res = await fetch(`${baseUrl}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(badConfig),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(Array.isArray(body.errors));
    assert.ok(body.errors.length > 0);
  });

  it("GET /api/status returns status", async () => {
    const res = await fetch(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok("artnet" in body);
    assert.ok("bridges" in body);
  });

  it("GET /api/bridges/discover returns discovered bridges", async () => {
    const res = await fetch(`${baseUrl}/api/bridges/discover`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 1);
    assert.equal(body[0].id, "disc-1");
  });

  it("GET /api/bridges/:id/resources returns 404 for unknown bridge", async () => {
    const res = await fetch(`${baseUrl}/api/bridges/nonexistent/resources`);
    assert.equal(res.status, 404);
  });
});
