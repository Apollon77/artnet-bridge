import { Router, type Request, type Response } from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HueClipClient } from "../HueClipClient.js";

const htmlPath = join(dirname(fileURLToPath(import.meta.url)), "hue-config.html");

function clipRoute(
  getClient: (bridgeId: string) => HueClipClient | undefined,
  fetchData: (client: HueClipClient) => Promise<unknown>,
  errorLabel: string,
): (req: Request<{ bridgeId: string }>, res: Response) => Promise<void> {
  return async (req: Request<{ bridgeId: string }>, res: Response) => {
    try {
      const client = getClient(req.params.bridgeId);
      if (!client) {
        res.status(404).json({ error: "Bridge not found" });
        return;
      }
      const data = await fetchData(client);
      res.json(data);
    } catch (e) {
      console.error(`Failed to fetch ${errorLabel}:`, e);
      res.status(500).json({ error: `Failed to fetch ${errorLabel}` });
    }
  };
}

export function createHueWebHandlers(
  getClient: (bridgeId: string) => HueClipClient | undefined,
): Router {
  const router = Router();

  // Serve the Hue config page at the root of /protocol/hue/
  router.get("/", (_req, res) => {
    res.sendFile(htmlPath);
  });

  router.get(
    "/entertainment-areas/:bridgeId",
    clipRoute(getClient, (c) => c.getEntertainmentConfigurations(), "entertainment areas"),
  );
  router.get(
    "/lights/:bridgeId",
    clipRoute(getClient, (c) => c.getLights(), "lights"),
  );
  router.get(
    "/rooms/:bridgeId",
    clipRoute(getClient, (c) => c.getRooms(), "rooms"),
  );
  router.get(
    "/zones/:bridgeId",
    clipRoute(getClient, (c) => c.getZones(), "zones"),
  );
  router.get(
    "/scenes/:bridgeId",
    clipRoute(getClient, (c) => c.getScenes(), "scenes"),
  );
  router.get(
    "/entertainment-services/:bridgeId",
    clipRoute(getClient, (c) => c.getEntertainmentServices(), "entertainment services"),
  );

  return router;
}
