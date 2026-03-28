// Hue protocol adapter
export { HueClipClient } from "./HueClipClient.js";
export type {
  HueLight,
  HueRoom,
  HueZone,
  HueGroupedLight,
  HueScene,
  HueEntertainmentConfiguration,
} from "./HueClipClient.js";
export { discoverBridges, parseMeetHueResponse } from "./HueDiscovery.js";
export type { FetchDiscoveryJson } from "./HueDiscovery.js";
export { pairWithBridge } from "./HuePairing.js";
export type { CreateClient } from "./HuePairing.js";
