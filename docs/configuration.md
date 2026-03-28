# Configuration

## File Location

| Path | Purpose |
|------|---------|
| `~/.artnet-bridge/config.json` | Default config file |
| `~/.artnet-bridge/config.lock` | PID-based lock file (prevents concurrent writes) |
| `~/.artnet-bridge/config.backup.json` | Auto-created before schema migrations |

Override the config path with `--config <path>`.

If the config file does not exist on first run, a default one is created.

## Full Schema

```jsonc
{
  "version": 1,

  "artnet": {
    "bindAddress": "0.0.0.0",   // UDP bind address
    "port": 6454                // ArtNet UDP port (standard: 6454)
  },

  "web": {
    "port": 8080,               // Web UI HTTP port
    "enabled": true             // Set false to disable web UI in config
  },

  "bridges": [
    {
      "id": "hue-living-room",           // Unique bridge identifier
      "name": "Living Room Hue",         // Display name (optional)
      "protocol": "hue",                 // Protocol adapter type
      "universe": 0,                     // ArtNet universe (0-based)

      "connection": {                    // Protocol-specific credentials
        "host": "192.168.1.42",
        "username": "abc123...",
        "clientkey": "def456..."         // Required for entertainment streaming
      },

      "channelMappings": [              // DMX channel assignments
        {
          "targetId": "abc-def-123",
          "targetType": "light",
          "dmxStart": 1,
          "channelMode": "8bit"
        }
      ],

      "rateLimits": {                   // Optional: override default rates
        "light": 8,
        "group": 1
      },

      "protocolConfig": {               // Protocol-specific settings
        "entertainmentConfigId": "ent-area-uuid"
      }
    }
  ]
}
```

## Bridge Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique identifier for this bridge |
| `name` | string | no | Human-readable display name |
| `protocol` | string | yes | Protocol adapter type (`"hue"`) |
| `connection` | object | yes | Protocol-specific credentials (from pairing) |
| `universe` | number | yes | ArtNet universe, 0-based |
| `channelMappings` | array | yes | DMX channel assignments (see below) |
| `rateLimits` | object | no | Override default rate limits per category |
| `protocolConfig` | object | no | Protocol-specific settings |

## Channel Mappings

Each mapping assigns a contiguous block of DMX channels to a target entity.

| Field | Type | Description |
|-------|------|-------------|
| `targetId` | string | Entity ID from the protocol adapter |
| `targetType` | string | Entity type (`"light"`, `"group"`, `"scene-selector"`) |
| `dmxStart` | number | First DMX channel (1-512) |
| `channelMode` | string | One of the modes below |

### Channel Modes

| Mode | Channels | Layout |
|------|----------|--------|
| `8bit` | 3 | R, G, B (0-255 each) |
| `8bit-dimmable` | 4 | Dim, R, G, B (0-255 each) |
| `16bit` | 6 | R-coarse, R-fine, G-coarse, G-fine, B-coarse, B-fine |
| `scene-selector` | 1 | Value 0 = no action, 1-255 maps to scene list |
| `brightness` | 1 | 0-255, scaled to 16-bit for group brightness |

The end address is computed automatically: `dmxEnd = dmxStart + channelWidth - 1`.

## Rate Limit Configuration

Protocol adapters declare rate limits per category with a hard maximum and a default. Users can override the default but not exceed the maximum.

For Hue bridges:

| Category | Max/sec | Default/sec | Description |
|----------|---------|-------------|-------------|
| `light` | 10 | 10 | Individual light REST calls |
| `group` | 1 | 1 | Group state changes |
| `scene` | 1 | 1 | Scene activations |

Realtime entities (entertainment streaming) are rate-limited separately at approximately 6Hz for value changes, while the DTLS stream itself runs at 50Hz.

To override:

```json
"rateLimits": {
  "light": 5
}
```

This reduces the light update rate to 5/sec on that bridge.

## Validation Rules

The following are validated at config save time and at startup:

- `dmxStart` must be between 1 and 512
- Computed `dmxEnd` must not exceed 512
- No overlapping DMX ranges within the same universe (checked across all bridges)
- `channelMode` must be compatible with the entity's `channelLayout` type
- `universe` must be >= 0
- Each bridge must have a non-empty `id` and `protocol`
- User rate limit overrides must be between 0 and the declared maximum

## Default Values

A fresh config file contains:

```json
{
  "version": 1,
  "artnet": {
    "bindAddress": "0.0.0.0",
    "port": 6454
  },
  "web": {
    "port": 8080,
    "enabled": true
  },
  "bridges": []
}
```
