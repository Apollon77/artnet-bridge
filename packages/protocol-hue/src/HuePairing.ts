import type { PairingResult } from "@artnet-bridge/protocol";
import { HueClipClient } from "./HueClipClient.js";

/**
 * Factory type for creating a HueClipClient.  The default creates a real
 * client; tests can inject a mock.
 */
export type CreateClient = (host: string) => Pick<HueClipClient, "createUser">;

function defaultCreateClient(host: string): Pick<HueClipClient, "createUser"> {
  return new HueClipClient(host, "");
}

/**
 * Pair with a Hue bridge.  The user must press the link button on the bridge
 * before calling this function.
 *
 * @param host         - IP / hostname of the Hue bridge
 * @param appName      - application name (max 20 chars)
 * @param instanceName - instance identifier (max 19 chars)
 * @param createClient - optional factory (for testing)
 */
export async function pairWithBridge(
  host: string,
  appName: string,
  instanceName: string,
  createClient: CreateClient = defaultCreateClient,
): Promise<PairingResult> {
  const client = createClient(host);
  try {
    const result = await client.createUser(appName, instanceName);
    return {
      success: true,
      connection: {
        host,
        username: result.username,
        clientkey: result.clientkey,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
