import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";

export class ConfigLock {
  constructor(private readonly lockPath: string) {}

  /** Acquire lock. Throws if already locked by another process. */
  acquire(): void {
    if (this.isLocked()) {
      throw new Error(`Config is locked by another process (lock file: ${this.lockPath})`);
    }
    writeFileSync(this.lockPath, String(process.pid));
  }

  /** Release lock. */
  release(): void {
    try {
      unlinkSync(this.lockPath);
    } catch {
      /* ignore — file may not exist */
    }
  }

  /** Check if lock exists and the owning process is still running. Clean stale locks. */
  isLocked(): boolean {
    if (!existsSync(this.lockPath)) return false;
    const pid = parseInt(readFileSync(this.lockPath, "utf-8").trim(), 10);
    if (isNaN(pid)) {
      this.release();
      return false;
    }
    try {
      process.kill(pid, 0); // just checks if process exists
      return pid !== process.pid; // locked by ANOTHER process
    } catch {
      this.release(); // stale lock
      return false;
    }
  }
}
