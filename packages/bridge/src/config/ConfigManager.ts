import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { ConfigLock } from "./ConfigLock.js";
import {
  type AppConfig,
  DEFAULT_CONFIG,
  CURRENT_CONFIG_VERSION,
  validateConfig,
} from "./ConfigSchema.js";

export class ConfigManager {
  readonly configPath: string;
  private readonly lock: ConfigLock;

  constructor(configPath?: string) {
    this.configPath = configPath ?? join(homedir(), ".artnet-bridge", "config.json");
    this.lock = new ConfigLock(this.configPath.replace(/\.json$/, ".lock"));
  }

  /** Load config from file. Creates default if missing. Throws on corrupt. */
  load(): AppConfig {
    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (!existsSync(this.configPath)) {
      const defaultConfig = structuredClone(DEFAULT_CONFIG);
      writeFileSync(this.configPath, JSON.stringify(defaultConfig, null, 2) + "\n", "utf-8");
      return defaultConfig;
    }

    const raw = readFileSync(this.configPath, "utf-8");
    let config: AppConfig;
    try {
      config = JSON.parse(raw) as AppConfig;
    } catch {
      throw new Error(`Config file is corrupt (invalid JSON): ${this.configPath}`);
    }

    // Migrate if version is old
    if (config.version !== CURRENT_CONFIG_VERSION) {
      const backupPath = this.configPath.replace(/\.json$/, ".backup.json");
      copyFileSync(this.configPath, backupPath);
      config = this.migrate(config);
      writeFileSync(this.configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    }

    return config;
  }

  /** Save config with validation and locking. */
  save(config: AppConfig): void {
    const errors = validateConfig(config);
    if (errors.length > 0) {
      throw new Error(`Invalid config:\n${errors.join("\n")}`);
    }

    const dir = dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.lock.acquire();
    try {
      writeFileSync(this.configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    } finally {
      this.lock.release();
    }
  }

  /** Get default config. */
  getDefault(): AppConfig {
    return structuredClone(DEFAULT_CONFIG);
  }

  /** Validate config, returns errors. */
  validate(config: AppConfig): string[] {
    return validateConfig(config);
  }

  /** Acquire config lock. */
  acquireLock(): void {
    this.lock.acquire();
  }

  /** Release config lock. */
  releaseLock(): void {
    this.lock.release();
  }

  /** Migrate config from older version. Currently a no-op placeholder for future migrations. */
  private migrate(config: AppConfig): AppConfig {
    // Future migrations go here (e.g. version 1 -> 2)
    // For now, just stamp the current version
    config.version = CURRENT_CONFIG_VERSION;
    return config;
  }
}
