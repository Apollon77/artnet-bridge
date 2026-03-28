import * as assert from "node:assert/strict";
import { parseArgs } from "../../src/cli.js";

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

  it("parses config discover command", () => {
    const result = parseArgs(["config", "discover"]);
    assert.equal(result.command, "config");
    assert.deepEqual(result.commandArgs, ["discover"]);
  });

  it("parses config pair command with host argument", () => {
    const result = parseArgs(["config", "pair", "192.168.1.10"]);
    assert.equal(result.command, "config");
    assert.deepEqual(result.commandArgs, ["pair", "192.168.1.10"]);
  });

  it("combines flags and commands", () => {
    const result = parseArgs(["--config", "/tmp/cfg.json", "--no-web", "config", "discover"]);
    assert.equal(result.configPath, "/tmp/cfg.json");
    assert.equal(result.noWeb, true);
    assert.equal(result.command, "config");
    assert.deepEqual(result.commandArgs, ["discover"]);
  });
});
