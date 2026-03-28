/**
 * Declares what DMX channels an entity consumes.
 * Defined by the protocol adapter per entity.
 */
export type ChannelLayout =
  | { type: "rgb" }
  | { type: "rgb-dimmable" }
  | { type: "scene-selector"; scenes: SceneEntry[] }
  | { type: "brightness" };

export interface SceneEntry {
  /** DMX value (1-255) that triggers this scene */
  index: number;
  /** Protocol-specific scene identifier */
  sceneId: string;
  /** Display name for UI */
  name: string;
}

/** All supported DMX channel modes */
export type ChannelMode = "8bit" | "8bit-dimmable" | "16bit" | "scene-selector" | "brightness";

/**
 * Returns the number of DMX channels consumed by a given channel mode.
 */
export function channelWidth(mode: ChannelMode): number {
  switch (mode) {
    case "8bit":
      return 3;
    case "8bit-dimmable":
      return 4;
    case "16bit":
      return 6;
    case "scene-selector":
      return 1;
    case "brightness":
      return 1;
  }
}
