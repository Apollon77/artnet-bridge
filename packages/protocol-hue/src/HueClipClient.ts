import * as https from "node:https";

// ---------------------------------------------------------------------------
// Hue CLIP v2 response envelope
// ---------------------------------------------------------------------------

interface ClipResponse<T> {
  errors: Array<{ description: string }>;
  data: T[];
}

// ---------------------------------------------------------------------------
// Resource types (simplified to what we need)
// ---------------------------------------------------------------------------

export interface HueLight {
  id: string;
  metadata: { name: string };
  type: string;
}

export interface HueRoom {
  id: string;
  metadata: { name: string };
  type: string;
  children: Array<{ rid: string; rtype: string }>;
  services: Array<{ rid: string; rtype: string }>;
}

export interface HueZone {
  id: string;
  metadata: { name: string };
  type: string;
  children: Array<{ rid: string; rtype: string }>;
  services: Array<{ rid: string; rtype: string }>;
}

export interface HueGroupedLight {
  id: string;
  owner: { rid: string; rtype: string };
  type: string;
}

export interface HueScene {
  id: string;
  metadata: { name: string };
  group: { rid: string; rtype: string };
  type: string;
}

export interface HueEntertainmentConfiguration {
  id: string;
  metadata: { name: string };
  type: string;
  status: string;
  channels: Array<{
    channel_id: number;
    position: { x: number; y: number; z: number };
    members: Array<{
      service: { rid: string; rtype: string };
      index: number;
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// Hue V1 pairing response types
// ---------------------------------------------------------------------------

interface HuePairingSuccess {
  success: { username: string; clientkey: string };
}

interface HuePairingError {
  error: { type: number; address: string; description: string };
}

type HuePairingResponse = HuePairingSuccess | HuePairingError;

// ---------------------------------------------------------------------------
// Low-level HTTPS helper
// ---------------------------------------------------------------------------

/** Issue an HTTPS request against a Hue bridge (self-signed cert). */
function httpsRequest(options: {
  host: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: options.host,
        port: 443,
        method: options.method,
        path: options.path,
        headers: options.headers,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// HueClipClient
// ---------------------------------------------------------------------------

export class HueClipClient {
  private readonly host: string;
  private readonly appKey: string;

  constructor(host: string, username: string) {
    this.host = host;
    this.appKey = username;
  }

  // --- Resource getters ---------------------------------------------------

  async getLights(): Promise<HueLight[]> {
    return this.clipGet<HueLight>("light");
  }

  async getRooms(): Promise<HueRoom[]> {
    return this.clipGet<HueRoom>("room");
  }

  async getZones(): Promise<HueZone[]> {
    return this.clipGet<HueZone>("zone");
  }

  async getGroupedLights(): Promise<HueGroupedLight[]> {
    return this.clipGet<HueGroupedLight>("grouped_light");
  }

  async getScenes(): Promise<HueScene[]> {
    return this.clipGet<HueScene>("scene");
  }

  async getEntertainmentConfigurations(): Promise<HueEntertainmentConfiguration[]> {
    return this.clipGet<HueEntertainmentConfiguration>("entertainment_configuration");
  }

  // --- State setters ------------------------------------------------------

  async setLightState(id: string, state: Record<string, unknown>): Promise<void> {
    await this.clipPut(`light/${encodeURIComponent(id)}`, state);
  }

  async setGroupedLightState(id: string, state: Record<string, unknown>): Promise<void> {
    await this.clipPut(`grouped_light/${encodeURIComponent(id)}`, state);
  }

  async activateScene(id: string): Promise<void> {
    await this.clipPut(`scene/${encodeURIComponent(id)}`, { recall: { action: "active" } });
  }

  // --- Entertainment ------------------------------------------------------

  async startEntertainment(id: string): Promise<void> {
    await this.clipPut(`entertainment_configuration/${encodeURIComponent(id)}`, {
      action: "start",
    });
  }

  async stopEntertainment(id: string): Promise<void> {
    await this.clipPut(`entertainment_configuration/${encodeURIComponent(id)}`, { action: "stop" });
  }

  // --- Pairing (V1 API) ---------------------------------------------------

  async createUser(
    appName: string,
    instanceName: string,
  ): Promise<{ username: string; clientkey: string }> {
    const res = await httpsRequest({
      host: this.host,
      method: "POST",
      path: "/api",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        devicetype: `${appName}#${instanceName}`,
        generateclientkey: true,
      }),
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Hue pairing error: ${String(res.statusCode)} ${res.body}`);
    }

    const parsed: unknown = JSON.parse(res.body);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error(`Hue pairing: unexpected response format`);
    }

    const first: HuePairingResponse = parsed[0];
    if ("error" in first) {
      throw new Error(`Hue pairing error: ${first.error.description}`);
    }
    return { username: first.success.username, clientkey: first.success.clientkey };
  }

  // --- Application ID for DTLS PSK identity ------------------------------

  async getApplicationId(): Promise<string> {
    const res = await httpsRequest({
      host: this.host,
      method: "GET",
      path: "/auth/v1",
      headers: { "hue-application-key": this.appKey },
    });

    const appId = res.headers["hue-application-id"];
    if (typeof appId === "string" && appId.trim().length > 0) {
      return appId.trim();
    }
    // Fall back to the username if header is missing
    return this.appKey;
  }

  // --- Private helpers ----------------------------------------------------

  /** GET a CLIP v2 resource list. */
  protected async clipGet<T>(resource: string): Promise<T[]> {
    const res = await httpsRequest({
      host: this.host,
      method: "GET",
      path: `/clip/v2/resource/${resource}`,
      headers: {
        "hue-application-key": this.appKey,
      },
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Hue API error: ${String(res.statusCode)} ${res.body}`);
    }

    const parsed: ClipResponse<T> = JSON.parse(res.body);
    return parsed.data;
  }

  /** PUT a CLIP v2 resource update. */
  protected async clipPut(resource: string, body: Record<string, unknown>): Promise<void> {
    const payload = JSON.stringify(body);
    const res = await httpsRequest({
      host: this.host,
      method: "PUT",
      path: `/clip/v2/resource/${resource}`,
      headers: {
        "hue-application-key": this.appKey,
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(payload)),
      },
      body: payload,
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Hue API error: ${String(res.statusCode)} ${res.body}`);
    }
  }
}
