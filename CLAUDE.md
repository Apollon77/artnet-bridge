# ArtNet Bridge

TypeScript ESM-only monorepo. Node >= 22.13.0. Build: esbuild + tsc. Lint: oxlint. Format: oxfmt. npm workspaces.

## Packages
- `packages/artnet` — ArtNet/DMX UDP receiver
- `packages/protocol` — base protocol types
- `packages/protocol-hue` — Hue adapter (Entertainment API + REST)
- `packages/bridge` — main app, web UI, config, orchestration
- `packages/tools` — internal build tooling

## Design Context

### Users
Lighting operators working backstage or in show control areas. Dark room environment — monitors are the primary light source. Two usage modes: (1) one-time configuration of bridges, entities, and channel mappings, and (2) real-time monitoring during live shows. The UI must serve both without getting in the way.

### Brand Personality
Functional, calm, utilitarian. This is a backstage tool — it should feel like reliable equipment, not a consumer app. Clarity and readability trump visual flair. Every element earns its place by being useful.

### Aesthetic Direction
- **Theme:** Dark only. Optimized for low-ambient-light environments where screen glare is a concern.
- **Palette:** Muted, low-chroma tones. No purple. Accent colors should aid comprehension (status, errors, activity) rather than decorate. High contrast for text readability without being harsh on eyes in the dark.
- **Anti-references:** Consumer dashboards with gradient accents, glowing neon, decorative sparklines. Anything that prioritizes looking impressive over being readable at 2am backstage.
- **References:** Theater lighting consoles (ETC Eos, GrandMA), broadcast monitoring tools, pro audio mixers — interfaces built for operators who stare at them for hours.

### Design Principles
1. **Readability in the dark** — Every color choice, contrast ratio, and font size must work in a dim room at arm's length. Avoid bright whites and saturated accents that cause eye fatigue.
2. **Status at a glance** — The monitoring view is the primary screen. Connection state, frame rates, and errors must be scannable in under 2 seconds without reading labels.
3. **Configure then forget** — Configuration UI can be denser and more detailed. Monitoring UI should be sparse and focused. Don't mix configuration noise into the monitoring view.
4. **No decoration** — If an element doesn't convey information or enable action, remove it. Borders, shadows, and color exist to separate content and signal state, not to look good.
