import * as assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigManager } from "../../src/config/ConfigManager.js";
import { ConfigLock } from "../../src/config/ConfigLock.js";
import {
  type AppConfig,
  CURRENT_CONFIG_VERSION,
  DEFAULT_CONFIG,
  validateConfig,
} from "../../src/config/ConfigSchema.js";
import type { DmxChannelMapping } from "@artnet-bridge/protocol";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "artnet-bridge-config-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// ConfigManager — load / save
// ---------------------------------------------------------------------------

describe("ConfigManager", () => {
  describe("load", () => {
    it("creates default config when file does not exist", () => {
      const configPath = join(tempDir, "sub", "config.json");
      const mgr = new ConfigManager(configPath);
      const config = mgr.load();

      assert.deepEqual(config, DEFAULT_CONFIG);
      // File should exist on disk now
      const raw = readFileSync(configPath, "utf-8");
      const ondisk = JSON.parse(raw) as AppConfig;
      assert.deepEqual(ondisk, DEFAULT_CONFIG);
    });

    it("reads existing config correctly", () => {
      const configPath = join(tempDir, "config.json");
      const custom: AppConfig = {
        ...structuredClone(DEFAULT_CONFIG),
        artnet: { bindAddress: "127.0.0.1", port: 6454 },
      };
      writeFileSync(configPath, JSON.stringify(custom, null, 2), "utf-8");

      const mgr = new ConfigManager(configPath);
      const loaded = mgr.load();
      assert.equal(loaded.artnet.bindAddress, "127.0.0.1");
    });

    it("throws on corrupt JSON", () => {
      const configPath = join(tempDir, "config.json");
      writeFileSync(configPath, "{{not valid json", "utf-8");

      const mgr = new ConfigManager(configPath);
      assert.throws(() => mgr.load(), /corrupt.*invalid JSON/i);
    });

    it("creates backup before migration", () => {
      const configPath = join(tempDir, "config.json");
      const oldConfig = { ...structuredClone(DEFAULT_CONFIG), version: 0 };
      writeFileSync(configPath, JSON.stringify(oldConfig, null, 2), "utf-8");

      const mgr = new ConfigManager(configPath);
      mgr.load();

      const backupPath = join(tempDir, "config.backup.json");
      const backupRaw = readFileSync(backupPath, "utf-8");
      const backup = JSON.parse(backupRaw) as AppConfig;
      assert.equal(backup.version, 0);

      // Migrated file should have current version
      const migratedRaw = readFileSync(configPath, "utf-8");
      const migrated = JSON.parse(migratedRaw) as AppConfig;
      assert.equal(migrated.version, CURRENT_CONFIG_VERSION);
    });
  });

  describe("save", () => {
    it("validates and writes config", () => {
      const configPath = join(tempDir, "config.json");
      const mgr = new ConfigManager(configPath);
      const config = mgr.getDefault();

      mgr.save(config);

      const raw = readFileSync(configPath, "utf-8");
      const ondisk = JSON.parse(raw) as AppConfig;
      assert.deepEqual(ondisk, config);
    });

    it("rejects config with dmxEnd > 512", () => {
      const configPath = join(tempDir, "config.json");
      const mgr = new ConfigManager(configPath);
      const config = mgr.getDefault();

      const mapping: DmxChannelMapping = {
        targetId: "light-1",
        targetType: "light",
        dmxStart: 511,
        channelMode: "8bit", // width 3, so end = 513
      };
      config.bridges.push({
        id: "bridge-1",
        protocol: "hue",
        connection: {},
        universe: 0,
        channelMappings: [mapping],
      });

      assert.throws(() => mgr.save(config), /Invalid config/);
    });

    it("rejects config with overlapping channels", () => {
      const configPath = join(tempDir, "config.json");
      const mgr = new ConfigManager(configPath);
      const config = mgr.getDefault();

      const mapping1: DmxChannelMapping = {
        targetId: "light-1",
        targetType: "light",
        dmxStart: 1,
        channelMode: "8bit", // width 3 -> 1-3
      };
      const mapping2: DmxChannelMapping = {
        targetId: "light-2",
        targetType: "light",
        dmxStart: 3,
        channelMode: "8bit", // width 3 -> 3-5, overlaps with light-1
      };
      config.bridges.push({
        id: "bridge-1",
        protocol: "hue",
        connection: {},
        universe: 0,
        channelMappings: [mapping1, mapping2],
      });

      assert.throws(() => mgr.save(config), /Invalid config/);
    });
  });

  describe("getDefault", () => {
    it("returns a deep clone of the default config", () => {
      const mgr = new ConfigManager(join(tempDir, "config.json"));
      const a = mgr.getDefault();
      const b = mgr.getDefault();
      assert.deepEqual(a, b);
      assert.notEqual(a, b); // different object references
    });
  });
});

// ---------------------------------------------------------------------------
// validateConfig
// ---------------------------------------------------------------------------

describe("validateConfig", () => {
  it("returns no errors for valid default config", () => {
    const errors = validateConfig(structuredClone(DEFAULT_CONFIG));
    assert.equal(errors.length, 0);
  });

  it("detects unknown config version", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.version = 999;
    const errors = validateConfig(config);
    assert.ok(errors.some((e) => e.includes("Unknown config version")));
  });

  it("detects cross-bridge overlapping channels on same universe", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.bridges.push(
      {
        id: "b1",
        protocol: "hue",
        connection: {},
        universe: 0,
        channelMappings: [
          { targetId: "light-1", targetType: "light", dmxStart: 1, channelMode: "8bit" },
        ],
      },
      {
        id: "b2",
        protocol: "hue",
        connection: {},
        universe: 0,
        channelMappings: [
          { targetId: "light-2", targetType: "light", dmxStart: 3, channelMode: "8bit" },
        ],
      },
    );
    const errors = validateConfig(config);
    assert.ok(errors.some((e) => e.includes("overlap") && e.includes("Universe 0")));
  });
});

// ---------------------------------------------------------------------------
// ConfigLock
// ---------------------------------------------------------------------------

describe("ConfigLock", () => {
  it("acquire succeeds when unlocked", () => {
    const lockPath = join(tempDir, "test.lock");
    const lock = new ConfigLock(lockPath);
    lock.acquire();
    // Should have written PID
    const pid = readFileSync(lockPath, "utf-8").trim();
    assert.equal(pid, String(process.pid));
    lock.release();
  });

  it("acquire fails when locked by another PID", () => {
    const lockPath = join(tempDir, "test.lock");
    // Write PID 1 (init process, always running)
    writeFileSync(lockPath, "1");

    const lock = new ConfigLock(lockPath);
    assert.throws(() => lock.acquire(), /locked by another process/);
  });

  it("stale lock (PID not running) gets cleaned up", () => {
    const lockPath = join(tempDir, "test.lock");
    // Use an absurdly high PID that won't exist
    writeFileSync(lockPath, "999999999");

    const lock = new ConfigLock(lockPath);
    assert.equal(lock.isLocked(), false);
    // Lock file should have been cleaned up
    lock.acquire(); // should succeed
    lock.release();
  });

  it("cleans up lock with invalid content", () => {
    const lockPath = join(tempDir, "test.lock");
    writeFileSync(lockPath, "not-a-pid");

    const lock = new ConfigLock(lockPath);
    assert.equal(lock.isLocked(), false);
  });

  it("release is idempotent", () => {
    const lockPath = join(tempDir, "test.lock");
    const lock = new ConfigLock(lockPath);
    // Should not throw even if lock doesn't exist
    lock.release();
    lock.release();
  });
});
