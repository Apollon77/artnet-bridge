import * as assert from "node:assert/strict";
import { pairWithBridge } from "../src/HuePairing.js";
import type { CreateClient } from "../src/HuePairing.js";

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

function mockClient(response: { username: string; clientkey: string }): CreateClient {
  return (_host: string) => ({
    createUser: async (_appName: string, _instanceName: string) => response,
  });
}

function failingClient(errorMessage: string): CreateClient {
  return (_host: string) => ({
    createUser: async (_appName: string, _instanceName: string) => {
      throw new Error(errorMessage);
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pairWithBridge", () => {
  it("should return success with connection data on successful pairing", async () => {
    const factory = mockClient({
      username: "generated-username-123",
      clientkey: "AABBCCDDEEFF00112233445566778899",
    });

    const result = await pairWithBridge("192.168.1.42", "artnet-bridge", "cli", factory);

    assert.equal(result.success, true);
    assert.ok(result.connection);
    assert.equal(result.connection.host, "192.168.1.42");
    assert.equal(result.connection.username, "generated-username-123");
    assert.equal(result.connection.clientkey, "AABBCCDDEEFF00112233445566778899");
    assert.equal(result.error, undefined);
  });

  it("should return failure when link button not pressed", async () => {
    const factory = failingClient("link button not pressed");

    const result = await pairWithBridge("192.168.1.42", "artnet-bridge", "cli", factory);

    assert.equal(result.success, false);
    assert.equal(result.error, "link button not pressed");
    assert.equal(result.connection, undefined);
  });

  it("should return failure on network error", async () => {
    const factory = failingClient("connect ECONNREFUSED 192.168.1.42:443");

    const result = await pairWithBridge("192.168.1.42", "artnet-bridge", "cli", factory);

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("ECONNREFUSED"));
    assert.equal(result.connection, undefined);
  });

  it("should pass the correct host to the client factory", async () => {
    let capturedHost = "";
    const factory: CreateClient = (host: string) => {
      capturedHost = host;
      return {
        createUser: async () => ({ username: "u", clientkey: "k" }),
      };
    };

    await pairWithBridge("10.0.0.5", "app", "inst", factory);

    assert.equal(capturedHost, "10.0.0.5");
  });
});
