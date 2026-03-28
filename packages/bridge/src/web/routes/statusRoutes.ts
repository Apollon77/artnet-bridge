import { Router } from "express";
import type { BridgeOrchestrator } from "../../BridgeOrchestrator.js";

export function createStatusRoutes(orchestrator: BridgeOrchestrator): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    res.json(orchestrator.getStatus());
  });

  return router;
}
