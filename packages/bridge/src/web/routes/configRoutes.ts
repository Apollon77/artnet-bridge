import { Router } from "express";
import type { ConfigManager } from "../../config/ConfigManager.js";
import type { AppConfig } from "../../config/ConfigSchema.js";

export function createConfigRoutes(configManager: ConfigManager): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      const config = configManager.load();
      res.json(config);
    } catch (err) {
      console.error("Error loading config:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.put("/", async (req, res) => {
    try {
      const body: unknown = req.body;
      const shapeErrors = validateAppConfigShape(body);
      if (shapeErrors.length > 0) {
        res.status(400).json({ errors: shapeErrors });
        return;
      }

      // Shape validated — safe to treat as AppConfig
      const config = body as AppConfig;

      const errors = configManager.validate(config);
      if (errors.length > 0) {
        res.status(400).json({ errors });
        return;
      }

      configManager.save(config);
      res.json({ success: true });
    } catch (err) {
      console.error("Error saving config:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}

/**
 * Deep structural validation of incoming config body.
 * Returns an array of error messages (empty = valid shape).
 */
function validateAppConfigShape(value: unknown): string[] {
  const errors: string[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return ["Request body must be a JSON object"];
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj["version"] !== "number") {
    errors.push("'version' must be a number");
  }

  if (typeof obj["artnet"] !== "object" || obj["artnet"] === null) {
    errors.push("'artnet' must be an object");
  }

  if (typeof obj["web"] !== "object" || obj["web"] === null) {
    errors.push("'web' must be an object");
  }

  if (!Array.isArray(obj["bridges"])) {
    errors.push("'bridges' must be an array");
  } else {
    const bridges = obj["bridges"] as unknown[];
    for (let i = 0; i < bridges.length; i++) {
      const b = bridges[i];
      if (typeof b !== "object" || b === null || Array.isArray(b)) {
        errors.push(`bridges[${String(i)}] must be an object`);
        continue;
      }
      const bridge = b as Record<string, unknown>;
      if (typeof bridge["id"] !== "string" || bridge["id"].length === 0) {
        errors.push(`bridges[${String(i)}]: 'id' must be a non-empty string`);
      }
      if (typeof bridge["protocol"] !== "string" || bridge["protocol"].length === 0) {
        errors.push(`bridges[${String(i)}]: 'protocol' must be a non-empty string`);
      }
      if (typeof bridge["universe"] !== "number") {
        errors.push(`bridges[${String(i)}]: 'universe' must be a number`);
      }
      if (!Array.isArray(bridge["channelMappings"])) {
        errors.push(`bridges[${String(i)}]: 'channelMappings' must be an array`);
      }
      if (typeof bridge["connection"] !== "object" || bridge["connection"] === null) {
        errors.push(`bridges[${String(i)}]: 'connection' must be an object`);
      }
    }
  }

  return errors;
}
