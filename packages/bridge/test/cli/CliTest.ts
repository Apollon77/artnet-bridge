import * as assert from "node:assert/strict";
import { parseArgs, coerceValue, setByPath, getByPath } from "../../src/cli.js";

describe("parseArgs", () => {
  it("returns defaults when no arguments provided", () => {
    const result = parseArgs([]);
    assert.equal(result.configPath, undefined);
    assert.equal(result.webPort, undefined);
    assert.equal(result.noWeb, false);
    assert.equal(result.command, undefined);
    assert.deepEqual(result.commandArgs, []);
  });

  it("parses --config flag", () => {
    const result = parseArgs(["--config", "/tmp/test.json"]);
    assert.equal(result.configPath, "/tmp/test.json");
  });

  it("parses --port flag", () => {
    const result = parseArgs(["--port", "9090"]);
    assert.equal(result.webPort, 9090);
  });

  it("parses --no-web flag", () => {
    const result = parseArgs(["--no-web"]);
    assert.equal(result.noWeb, true);
  });

  it("parses config discover command with protocol", () => {
    const result = parseArgs(["config", "discover", "hue"]);
    assert.equal(result.command, "config");
    assert.deepEqual(result.commandArgs, ["discover", "hue"]);
  });

  it("parses config pair command with protocol and host", () => {
    const result = parseArgs(["config", "pair", "hue", "192.168.1.10"]);
    assert.equal(result.command, "config");
    assert.deepEqual(result.commandArgs, ["pair", "hue", "192.168.1.10"]);
  });

  it("combines flags and commands", () => {
    const result = parseArgs([
      "--config",
      "/tmp/cfg.json",
      "--no-web",
      "config",
      "discover",
      "hue",
    ]);
    assert.equal(result.configPath, "/tmp/cfg.json");
    assert.equal(result.noWeb, true);
    assert.equal(result.command, "config");
    assert.deepEqual(result.commandArgs, ["discover", "hue"]);
  });

  it("parses config set command with key and value", () => {
    const result = parseArgs(["config", "set", "artnet.port", "6454"]);
    assert.equal(result.command, "config");
    assert.deepEqual(result.commandArgs, ["set", "artnet.port", "6454"]);
  });

  it("parses config get command with key", () => {
    const result = parseArgs(["config", "get", "web.port"]);
    assert.equal(result.command, "config");
    assert.deepEqual(result.commandArgs, ["get", "web.port"]);
  });

  it("parses config show command", () => {
    const result = parseArgs(["config", "show"]);
    assert.equal(result.command, "config");
    assert.deepEqual(result.commandArgs, ["show"]);
  });
});

describe("coerceValue", () => {
  it("converts 'true' to boolean true", () => {
    assert.equal(coerceValue("true"), true);
  });

  it("converts 'false' to boolean false", () => {
    assert.equal(coerceValue("false"), false);
  });

  it("converts numeric strings to numbers", () => {
    assert.equal(coerceValue("6454"), 6454);
    assert.equal(coerceValue("0"), 0);
    assert.equal(coerceValue("3.14"), 3.14);
    assert.equal(coerceValue("-1"), -1);
  });

  it("keeps non-numeric strings as strings", () => {
    assert.equal(coerceValue("hello"), "hello");
    assert.equal(coerceValue("192.168.1.5"), "192.168.1.5");
    assert.equal(coerceValue(""), "");
  });
});

describe("setByPath", () => {
  it("sets a top-level key", () => {
    const obj: Record<string, unknown> = { a: 1 };
    setByPath(obj, "b", 2);
    assert.equal(obj.b, 2);
  });

  it("sets a nested key", () => {
    const obj: Record<string, unknown> = { artnet: { port: 6454 } };
    setByPath(obj, "artnet.port", 9999);
    assert.equal((obj.artnet as Record<string, unknown>).port, 9999);
  });

  it("creates intermediate objects", () => {
    const obj: Record<string, unknown> = {};
    setByPath(obj, "a.b.c", "deep");
    assert.equal(((obj.a as Record<string, unknown>).b as Record<string, unknown>).c, "deep");
  });

  it("creates intermediate arrays for numeric keys", () => {
    const obj: Record<string, unknown> = {};
    setByPath(obj, "bridges.0.name", "Test");
    const bridges = obj.bridges as unknown[];
    assert.ok(Array.isArray(bridges));
    assert.equal((bridges[0] as Record<string, unknown>).name, "Test");
  });

  it("sets into existing arrays", () => {
    const obj: Record<string, unknown> = { items: [{ x: 1 }] };
    setByPath(obj, "items.0.x", 99);
    assert.equal(((obj.items as unknown[])[0] as Record<string, unknown>).x, 99);
  });
});

describe("getByPath", () => {
  it("gets a top-level key", () => {
    assert.equal(getByPath({ a: 1 }, "a"), 1);
  });

  it("gets a nested key", () => {
    assert.equal(getByPath({ artnet: { port: 6454 } }, "artnet.port"), 6454);
  });

  it("returns undefined for missing keys", () => {
    assert.equal(getByPath({ a: 1 }, "b"), undefined);
    assert.equal(getByPath({ a: 1 }, "a.b.c"), undefined);
  });

  it("gets array elements by index", () => {
    assert.equal(getByPath({ items: ["a", "b", "c"] }, "items.1"), "b");
  });

  it("gets nested object values", () => {
    const obj = { bridges: [{ name: "Test", universe: 0 }] };
    assert.equal(getByPath(obj, "bridges.0.name"), "Test");
  });
});
