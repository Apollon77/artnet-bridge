export interface RateLimitBudget {
  /** Hard limit — cannot be exceeded */
  maxPerSecond: number;
  /** Used when user has not configured an override */
  defaultPerSecond: number;
  /** Shown in config/UI as informational text */
  description: string;
}
