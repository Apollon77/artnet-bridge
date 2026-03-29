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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pair with a Hue bridge.  Polls repeatedly until the link button is pressed
 * or the timeout expires.
 *
 * @param host         - IP / hostname of the Hue bridge
 * @param appName      - application name (max 20 chars)
 * @param instanceName - instance identifier (max 19 chars)
 * @param options      - optional: createClient factory, timeout, poll interval
 */
export async function pairWithBridge(
  host: string,
  appName: string,
  instanceName: string,
  options?: {
    createClient?: CreateClient;
    /** Timeout in seconds (default: 30) */
    timeoutSec?: number;
    /** Poll interval in milliseconds (default: 2000) */
    pollIntervalMs?: number;
  },
): Promise<PairingResult> {
  const createClient = options?.createClient ?? defaultCreateClient;
  const timeoutMs = (options?.timeoutSec ?? 30) * 1000;
  const pollIntervalMs = options?.pollIntervalMs ?? 2000;

  const client = createClient(host);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
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
      const message = error instanceof Error ? error.message : String(error);

      // "link button not pressed" means we should keep trying
      if (message.toLowerCase().includes("link button")) {
        if (Date.now() + pollIntervalMs >= deadline) {
          return {
            success: false,
            error: "Timeout: link button was not pressed within the allowed time",
          };
        }
        await delay(pollIntervalMs);
        continue;
      }

      // Any other error is a real failure — don't retry
      return {
        success: false,
        error: message,
      };
    }
  }

  return {
    success: false,
    error: "Timeout: link button was not pressed within the allowed time",
  };
}
