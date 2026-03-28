import { Router } from "express";
import type { ProtocolAdapter, ProtocolBridge } from "@artnet-bridge/protocol";

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

  router.post("/:id/test", (req, res) => {
    const bridgeId = req.params.id;
    const body: unknown = req.body;

    if (typeof body !== "object" || body === null || !hasColorArray(body)) {
      res.status(400).json({ error: "Request body must contain color: [r, g, b]" });
      return;
    }

    const [r, g, b] = body.color;

    void findBridgeAndAdapter(adapters, bridgeId)
      .then((result) => {
        if (!result) {
          res.status(404).json({ error: `Bridge not found: ${bridgeId}` });
          return;
        }

        const { adapter, bridge } = result;

        // Try realtime entities first, then limited
        const realtimeEntities = bridge.entities.filter((e) => e.controlMode === "realtime");
        const limitedEntities = bridge.entities.filter(
          (e) => e.controlMode === "limited" && e.category === "light",
        );

        const updates = realtimeEntities.map((entity) => ({
          entityId: entity.id,
          value: { type: "rgb" as const, r, g, b },
        }));

        const promises: Promise<void>[] = [];

        if (updates.length > 0) {
          promises.push(adapter.handleRealtimeUpdate(bridgeId, updates));
        }

        for (const entity of limitedEntities) {
          promises.push(
            adapter.handleLimitedUpdate(bridgeId, entity.id, {
              type: "rgb",
              r,
              g,
              b,
            }),
          );
        }

        if (promises.length === 0) {
          res.status(400).json({ error: "No controllable light entities on this bridge" });
          return;
        }

        return Promise.all(promises).then(() => {
          res.json({ ok: true });
        });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Test update failed";
        res.status(500).json({ error: message });
      });
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

function hasColorArray(obj: object): obj is { color: [number, number, number] } {
  if (!("color" in obj)) return false;
  const color = (obj as Record<string, unknown>).color;
  if (!Array.isArray(color) || color.length !== 3) return false;
  return color.every((c) => typeof c === "number");
}

async function findBridgeAndAdapter(
  adapters: ProtocolAdapter[],
  bridgeId: string,
): Promise<{ adapter: ProtocolAdapter; bridge: ProtocolBridge } | null> {
  for (const adapter of adapters) {
    const bridges = await adapter.getBridges();
    const bridge = bridges.find((b) => b.id === bridgeId);
    if (bridge) {
      return { adapter, bridge };
    }
  }
  return null;
}
