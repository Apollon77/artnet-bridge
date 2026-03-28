import * as assert from "node:assert/strict";
import { discoverBridges, parseMeetHueResponse } from "../src/HueDiscovery.js";

// ---------------------------------------------------------------------------
// parseMeetHueResponse – unit tests for the parsing logic
// ---------------------------------------------------------------------------

describe("parseMeetHueResponse", () => {
  it("should parse a valid response with one bridge", () => {
    const json = [{ id: "001788fffe123456", internalipaddress: "192.168.1.42", port: 443 }];
    const result = parseMeetHueResponse(json);

    assert.equal(result.length, 1);
    assert.equal(result[0].id, "001788fffe123456");
    assert.equal(result[0].host, "192.168.1.42");
    assert.equal(result[0].protocol, "hue");
    assert.deepEqual(result[0].metadata, { port: 443 });
  });

  it("should parse multiple bridges", () => {
    const json = [
      { id: "bridge-1", internalipaddress: "10.0.0.1" },
      { id: "bridge-2", internalipaddress: "10.0.0.2", port: 8443 },
    ];
    const result = parseMeetHueResponse(json);

    assert.equal(result.length, 2);
    assert.equal(result[0].host, "10.0.0.1");
    assert.deepEqual(result[0].metadata, {});
    assert.equal(result[1].host, "10.0.0.2");
    assert.deepEqual(result[1].metadata, { port: 8443 });
  });

  it("should return empty array for empty JSON array", () => {
    assert.deepEqual(parseMeetHueResponse([]), []);
  });

  it("should return empty array for non-array input", () => {
    assert.deepEqual(parseMeetHueResponse("not an array"), []);
    assert.deepEqual(parseMeetHueResponse(null), []);
    assert.deepEqual(parseMeetHueResponse(42), []);
    assert.deepEqual(parseMeetHueResponse({}), []);
  });

  it("should skip entries with missing required fields", () => {
    const json = [
      { id: "valid", internalipaddress: "1.2.3.4" },
      { id: "missing-ip" },
      { internalipaddress: "5.6.7.8" },
      { id: 123, internalipaddress: "9.10.11.12" }, // id not a string
    ];
    const result = parseMeetHueResponse(json);

    assert.equal(result.length, 1);
    assert.equal(result[0].id, "valid");
  });
});

// ---------------------------------------------------------------------------
// discoverBridges – integration-style tests with injected fetcher
// ---------------------------------------------------------------------------

describe("discoverBridges", () => {
  it("should return parsed bridges from successful fetch", async () => {
    const fakeFetch = async () => [{ id: "abc", internalipaddress: "192.168.1.100", port: 443 }];

    const bridges = await discoverBridges(fakeFetch);

    assert.equal(bridges.length, 1);
    assert.equal(bridges[0].id, "abc");
    assert.equal(bridges[0].host, "192.168.1.100");
    assert.equal(bridges[0].protocol, "hue");
  });

  it("should return empty array when fetch returns empty list", async () => {
    const fakeFetch = async () => [];
    const bridges = await discoverBridges(fakeFetch);

    assert.equal(bridges.length, 0);
  });

  it("should return empty array on network failure", async () => {
    const fakeFetch = async (): Promise<unknown> => {
      throw new Error("Network unreachable");
    };

    const bridges = await discoverBridges(fakeFetch);

    assert.equal(bridges.length, 0);
  });

  it("should return empty array when fetch returns invalid JSON shape", async () => {
    const fakeFetch = async () => "not json array";
    const bridges = await discoverBridges(fakeFetch);

    assert.equal(bridges.length, 0);
  });
});
