// ArtNet Bridge - main application package
export { ConfigManager } from "./config/ConfigManager.js";
export { ConfigLock } from "./config/ConfigLock.js";
export {
  type AppConfig,
  type BridgeConfig,
  CURRENT_CONFIG_VERSION,
  DEFAULT_CONFIG,
  validateConfig,
} from "./config/ConfigSchema.js";
