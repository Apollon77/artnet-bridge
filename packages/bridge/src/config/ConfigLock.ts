import { readFileSync, writeFileSync, unlinkSync } from "node:fs";

export class ConfigLock {
  constructor(private readonly lockPath: string) {}

  /** Acquire lock. Throws if already locked by another process. */
  acquire(): void {
    try {
      writeFileSync(this.lockPath, String(process.pid), { flag: "wx" });
    } catch {
      // File exists — check if stale
      if (this.isStale()) {
        this.release();
        writeFileSync(this.lockPath, String(process.pid), { flag: "wx" });
      } else {
        throw new Error(`Config is locked by another process (lock file: ${this.lockPath})`);
      }
    }
  }

  /** Release lock. */
  release(): void {
    try {
      unlinkSync(this.lockPath);
    } catch {
      /* ignore — file may not exist */
    }
  }

  /** Check if lock file is stale (owner process not running or same process from a crash). */
  private isStale(): boolean {
    try {
      const pid = parseInt(readFileSync(this.lockPath, "utf-8").trim(), 10);
      if (isNaN(pid)) return true;
      process.kill(pid, 0); // just checks if process exists
      return pid === process.pid; // same process = stale from previous crash
    } catch {
      return true; // process not running = stale
    }
  }
}
