import { ChannelMode, channelWidth } from "./ChannelLayout.js";

export interface DmxChannelMapping {
    targetId: string;
    targetType: string;
    dmxStart: number; // 1-512
    channelMode: ChannelMode;
}

/**
 * Compute the end DMX address for a mapping (inclusive).
 */
export function computeDmxEnd(mapping: DmxChannelMapping): number {
    return mapping.dmxStart + channelWidth(mapping.channelMode) - 1;
}

/**
 * Validate channel mappings: check bounds and overlaps within a universe.
 * Returns array of error messages (empty = valid).
 */
export function validateMappings(mappings: DmxChannelMapping[]): string[] {
    const errors: string[] = [];

    for (const mapping of mappings) {
        const end = computeDmxEnd(mapping);
        if (mapping.dmxStart < 1 || mapping.dmxStart > 512) {
            errors.push(`Mapping for ${mapping.targetId}: dmxStart ${mapping.dmxStart} out of range (1-512)`);
        }
        if (end > 512) {
            errors.push(`Mapping for ${mapping.targetId}: channels exceed universe boundary (dmxStart=${mapping.dmxStart}, end=${end})`);
        }
    }

    // Check overlaps
    const sorted = [...mappings].sort((a, b) => a.dmxStart - b.dmxStart);
    for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i];
        const next = sorted[i + 1];
        const currentEnd = computeDmxEnd(current);
        if (currentEnd >= next.dmxStart) {
            errors.push(`Mapping overlap: ${current.targetId} (${current.dmxStart}-${currentEnd}) overlaps with ${next.targetId} (${next.dmxStart})`);
        }
    }

    return errors;
}
