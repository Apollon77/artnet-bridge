import { Router } from "express";
import type { BridgeOrchestrator } from "../../BridgeOrchestrator.js";

export function createStatusRoutes(orchestrator: BridgeOrchestrator): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      res.json(orchestrator.getStatus());
    } catch (err) {
      console.error("Error getting status:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
