import { Router } from "express";
import { computeDmxEnd } from "@artnet-bridge/protocol";
import type { ProtocolAdapter, ProtocolBridge } from "@artnet-bridge/protocol";
import type { ConfigManager } from "../../config/ConfigManager.js";
import type { BridgeConfig } from "../../config/ConfigSchema.js";

export function createBridgeRoutes(
  adapters: ProtocolAdapter[],
  configManager?: ConfigManager,
): Router {
  const router = Router();

  router.get("/discover", async (_req, res) => {
    try {
      const results = [];
      for (const adapter of adapters) {
        const discovered = await adapter.discover();
        results.push(...discovered);
      }
      res.json(results);
    } catch (err) {
      console.error("Error discovering bridges:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/pair", async (req, res) => {
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

    try {
      const result = await adapter.pair({
        id: body.id,
        host: body.host,
        protocol: body.protocol,
        metadata: hasObjectProp(body, "metadata") ? body.metadata : {},
      });

      // Auto-save pairing credentials to config
      if (result.success && result.connection && configManager) {
        savePairingToConfig(configManager, body.host, body.protocol, result.connection);
      }

      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Pairing failed";
      res.status(500).json({ error: message });
    }
  });

  router.get("/:id/resources", async (req, res) => {
    try {
      const bridgeId = req.params.id;
      if (typeof bridgeId !== "string" || bridgeId.length === 0) {
        res.status(400).json({ error: "Bridge ID must be a non-empty string" });
        return;
      }
      for (const adapter of adapters) {
        const bridges = await adapter.getBridges();
        const bridge = bridges.find((b) => b.id === bridgeId);
        if (bridge) {
          // Look up channel mappings from config
          const bridgeConfig = configManager
            ? configManager.load().bridges.find((b) => b.id === bridgeId)
            : undefined;
          const mappings = bridgeConfig?.channelMappings ?? [];

          const augmented = bridge.entities.map((entity) => {
            const mapping = mappings.find((m) => m.targetId === entity.id);
            return {
              ...entity,
              dmxMapping: mapping
                ? {
                    dmxStart: mapping.dmxStart,
                    channelMode: mapping.channelMode,
                    dmxEnd: computeDmxEnd(mapping),
                  }
                : null,
            };
          });

          res.json(augmented);
          return;
        }
      }
      res.status(404).json({ error: `Bridge not found: ${bridgeId}` });
    } catch (err) {
      console.error("Error getting bridge resources:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/:id/test", async (req, res) => {
    const bridgeId = req.params.id;
    if (typeof bridgeId !== "string" || bridgeId.length === 0) {
      res.status(400).json({ error: "Bridge ID must be a non-empty string" });
      return;
    }
    const body: unknown = req.body;

    if (typeof body !== "object" || body === null || !hasColorArray(body)) {
      res.status(400).json({ error: "Request body must contain color: [r, g, b]" });
      return;
    }

    const [r, g, b] = body.color;

    // Optional: only test specific entities
    const entityIds = hasStringArray(body, "entityIds") ? body.entityIds : null;

    try {
      const result = await findBridgeAndAdapter(adapters, bridgeId);
      if (!result) {
        res.status(404).json({ error: `Bridge not found: ${bridgeId}` });
        return;
      }

      const { adapter, bridge } = result;

      // Filter to selected entities if provided
      const selectedEntities = entityIds
        ? bridge.entities.filter((e) => entityIds.includes(e.id))
        : bridge.entities;

      // Try realtime entities first, then limited
      const realtimeEntities = selectedEntities.filter((e) => e.controlMode === "realtime");
      const limitedEntities = selectedEntities.filter(
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

      await Promise.all(promises);
      res.json({ ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Test update failed";
      res.status(500).json({ error: message });
    }
  });

  return router;
}

/** Save pairing credentials into the config file as a new bridge entry. */
function savePairingToConfig(
  configManager: ConfigManager,
  host: string,
  protocol: string,
  connection: Record<string, unknown>,
): void {
  try {
    const config = configManager.load();
    const bridgeId = `${protocol}-${host.replace(/\./g, "-")}`;

    // Don't duplicate if already exists
    if (config.bridges.some((b) => b.id === bridgeId)) {
      return;
    }

    const newBridge: BridgeConfig = {
      id: bridgeId,
      name: `${protocol} @ ${host}`,
      protocol,
      connection,
      universe: 0,
      channelMappings: [],
    };
    config.bridges.push(newBridge);
    configManager.save(config);
  } catch {
    // Best-effort save — don't fail the pairing response
  }
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

function hasStringArray<K extends string>(
  obj: object,
  key: K,
): obj is object & Record<K, string[]> {
  if (!(key in obj)) return false;
  const val = (obj as Record<string, unknown>)[key];
  return Array.isArray(val) && val.every((v) => typeof v === "string");
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
