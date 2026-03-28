import { Router } from "express";
import type { ConfigManager } from "../../config/ConfigManager.js";
import type { AppConfig } from "../../config/ConfigSchema.js";

export function createConfigRoutes(configManager: ConfigManager): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const config = configManager.load();
    res.json(config);
  });

  router.put("/", (req, res) => {
    const body: unknown = req.body;
    if (!isAppConfigShape(body)) {
      res.status(400).json({ errors: ["Request body must be a valid config object"] });
      return;
    }

    const errors = configManager.validate(body);
    if (errors.length > 0) {
      res.status(400).json({ errors });
      return;
    }

    configManager.save(body);
    res.json({ success: true });
  });

  return router;
}

/** Structural type guard: checks that value has the shape of AppConfig. */
function isAppConfigShape(value: unknown): value is AppConfig {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj["version"] === "number" &&
    typeof obj["artnet"] === "object" &&
    obj["artnet"] !== null &&
    typeof obj["web"] === "object" &&
    obj["web"] !== null &&
    Array.isArray(obj["bridges"])
  );
}
