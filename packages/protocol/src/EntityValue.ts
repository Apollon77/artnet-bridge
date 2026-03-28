/**
 * Values passed from bridge core to protocol adapters.
 * All color values normalized to 16-bit (0-65535).
 */
export type EntityValue =
  | { type: "rgb"; r: number; g: number; b: number }
  | { type: "rgb-dimmable"; dim: number; r: number; g: number; b: number }
  | { type: "scene-selector"; sceneId: string }
  | { type: "brightness"; value: number };

export interface EntityUpdate {
  entityId: string;
  value: EntityValue;
}
