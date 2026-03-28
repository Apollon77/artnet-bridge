import { Router } from "express";
import type { ProtocolAdapter } from "@artnet-bridge/protocol";

export function createBridgeRoutes(adapters: ProtocolAdapter[]): Router {
  const router = Router();

  router.get("/discover", async (_req, res) => {
    const results = [];
    for (const adapter of adapters) {
      const discovered = await adapter.discover();
      results.push(...discovered);
    }
    res.json(results);
  });

  router.post("/pair", (req, res) => {
    const body: unknown = req.body;
    if (typeof body !== "object" || body === null) {
      res.status(400).json({ error: "Request body must be a JSON object" });
      return;
    }
    if (
      !hasStringProp(body, "protocol") ||
      !hasStringProp(body, "id") ||
      !hasStringProp(body, "host")
    ) {
      res.status(400).json({ error: "Missing required fields: protocol, id, host" });
      return;
    }

    const adapter = adapters.find((a) => a.type === body.protocol);
    if (!adapter) {
      res.status(404).json({ error: `No adapter for protocol: ${body.protocol}` });
      return;
    }

    void adapter
      .pair({
        id: body.id,
        host: body.host,
        protocol: body.protocol,
        metadata: hasObjectProp(body, "metadata") ? body.metadata : {},
      })
      .then((result) => {
        res.json(result);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Pairing failed";
        res.status(500).json({ error: message });
      });
  });

  router.get("/:id/resources", async (req, res) => {
    const bridgeId = req.params.id;
    for (const adapter of adapters) {
      const bridges = await adapter.getBridges();
      const bridge = bridges.find((b) => b.id === bridgeId);
      if (bridge) {
        res.json(bridge.entities);
        return;
      }
    }
    res.status(404).json({ error: `Bridge not found: ${bridgeId}` });
  });

  return router;
}

function hasStringProp<K extends string>(obj: object, key: K): obj is object & Record<K, string> {
  return key in obj && typeof (obj as Record<string, unknown>)[key] === "string";
}

function hasObjectProp<K extends string>(
  obj: object,
  key: K,
): obj is object & Record<K, Record<string, unknown>> {
  return (
    key in obj &&
    typeof (obj as Record<string, unknown>)[key] === "object" &&
    (obj as Record<string, unknown>)[key] !== null
  );
}
