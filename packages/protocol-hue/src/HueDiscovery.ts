import type { DiscoveredBridge } from "@artnet-bridge/protocol";

// ---------------------------------------------------------------------------
// meethue.com discovery response shape
// ---------------------------------------------------------------------------

interface MeetHueEntry {
  id: string;
  internalipaddress: string;
  port?: number;
}

// ---------------------------------------------------------------------------
// Parsing helper (exported for testing)
// ---------------------------------------------------------------------------

/** Convert raw meethue.com JSON into DiscoveredBridge[]. */
export function parseMeetHueResponse(json: unknown): DiscoveredBridge[] {
  if (!Array.isArray(json)) {
    return [];
  }

  const bridges: DiscoveredBridge[] = [];
  for (const entry of json) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      "id" in entry &&
      "internalipaddress" in entry &&
      typeof (entry as MeetHueEntry).id === "string" &&
      typeof (entry as MeetHueEntry).internalipaddress === "string"
    ) {
      const e = entry as MeetHueEntry;
      bridges.push({
        id: e.id,
        host: e.internalipaddress,
        protocol: "hue",
        metadata: {
          ...(e.port !== undefined ? { port: e.port } : {}),
        },
      });
    }
  }
  return bridges;
}

// ---------------------------------------------------------------------------
// Network fetcher (can be swapped in tests)
// ---------------------------------------------------------------------------

export type FetchDiscoveryJson = () => Promise<unknown>;

const MEETHUE_URL = "https://discovery.meethue.com";

/** Default fetcher that hits the real meethue.com endpoint. */
async function defaultFetchDiscoveryJson(): Promise<unknown> {
  const res = await fetch(MEETHUE_URL);
  if (!res.ok) {
    throw new Error(`Discovery request failed: ${String(res.status)} ${res.statusText}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover Hue bridges on the network via the Philips meethue.com cloud
 * endpoint (nUPnP / HTTP discovery).
 *
 * @param fetchJson - optional override for the HTTP call (useful in tests)
 */
export async function discoverBridges(
  fetchJson: FetchDiscoveryJson = defaultFetchDiscoveryJson,
): Promise<DiscoveredBridge[]> {
  try {
    const json = await fetchJson();
    return parseMeetHueResponse(json);
  } catch (error) {
    // Network errors, DNS failures, timeouts etc. — return empty list
    // so callers can fall back to manual IP entry.
    return [];
  }
}
