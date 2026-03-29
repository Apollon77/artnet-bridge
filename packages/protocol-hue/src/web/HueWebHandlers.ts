import { Router } from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HueClipClient } from "../HueClipClient.js";

const htmlPath = join(dirname(fileURLToPath(import.meta.url)), "hue-config.html");

export function createHueWebHandlers(
  getClient: (bridgeId: string) => HueClipClient | undefined,
): Router {
  const router = Router();

  // Serve the Hue config page at the root of /protocol/hue/
  router.get("/", (_req, res) => {
    res.sendFile(htmlPath);
  });

  // GET /entertainment-areas/:bridgeId — list entertainment areas for a bridge
  router.get("/entertainment-areas/:bridgeId", async (req, res) => {
    try {
      const client = getClient(req.params.bridgeId);
      if (!client) {
        res.status(404).json({ error: "Bridge not found" });
        return;
      }
      const configs = await client.getEntertainmentConfigurations();
      res.json(configs);
    } catch (e) {
      console.error("Failed to fetch entertainment areas:", e);
      res.status(500).json({ error: "Failed to fetch entertainment areas" });
    }
  });

  // GET /lights/:bridgeId — list all lights
  router.get("/lights/:bridgeId", async (req, res) => {
    try {
      const client = getClient(req.params.bridgeId);
      if (!client) {
        res.status(404).json({ error: "Bridge not found" });
        return;
      }
      const lights = await client.getLights();
      res.json(lights);
    } catch (e) {
      console.error("Failed to fetch lights:", e);
      res.status(500).json({ error: "Failed to fetch lights" });
    }
  });

  // GET /rooms/:bridgeId — list rooms
  router.get("/rooms/:bridgeId", async (req, res) => {
    try {
      const client = getClient(req.params.bridgeId);
      if (!client) {
        res.status(404).json({ error: "Bridge not found" });
        return;
      }
      const rooms = await client.getRooms();
      res.json(rooms);
    } catch (e) {
      console.error("Failed to fetch rooms:", e);
      res.status(500).json({ error: "Failed to fetch rooms" });
    }
  });

  // GET /zones/:bridgeId — list zones
  router.get("/zones/:bridgeId", async (req, res) => {
    try {
      const client = getClient(req.params.bridgeId);
      if (!client) {
        res.status(404).json({ error: "Bridge not found" });
        return;
      }
      const zones = await client.getZones();
      res.json(zones);
    } catch (e) {
      console.error("Failed to fetch zones:", e);
      res.status(500).json({ error: "Failed to fetch zones" });
    }
  });

  // GET /scenes/:bridgeId — list scenes
  router.get("/scenes/:bridgeId", async (req, res) => {
    try {
      const client = getClient(req.params.bridgeId);
      if (!client) {
        res.status(404).json({ error: "Bridge not found" });
        return;
      }
      const scenes = await client.getScenes();
      res.json(scenes);
    } catch (e) {
      console.error("Failed to fetch scenes:", e);
      res.status(500).json({ error: "Failed to fetch scenes" });
    }
  });

  return router;
}
