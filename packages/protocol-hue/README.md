# @artnet-bridge/protocol-hue

Philips Hue protocol adapter for ArtNet Bridge. Supports both realtime entertainment streaming (DTLS) and standard REST API control via the Hue CLIP v2 API.

## Discovery and Pairing

### Discovery

Bridges are discovered using two methods (tried in parallel):
- **mDNS** -- local network multicast query for `_hue._tcp.local`
- **Meethue cloud** -- fallback via `https://discovery.meethue.com`

```typescript
import { discoverBridges } from "@artnet-bridge/protocol-hue";

const bridges = await discoverBridges();
// [{ id: "001788...", host: "192.168.1.42", name: "Hue Bridge", protocol: "hue", metadata: { ... } }]
```

### Pairing

Pairing uses the Hue link-button flow. Press the physical button on the bridge, then call:

```typescript
import { pairWithBridge } from "@artnet-bridge/protocol-hue";

const result = await pairWithBridge("192.168.1.42", "artnet-bridge", "default");
// result.connection = { username: "abc...", clientkey: "def..." }
```

The `username` authenticates REST API calls. The `clientkey` is the PSK for DTLS entertainment streaming.

## Two Control Modes

### Entertainment Mode (Realtime)

DTLS streaming for low-latency color control of individual lights.

- **Protocol**: DTLS 1.2 over UDP port 2100, cipher `TLS_PSK_WITH_AES_128_GCM_SHA256`
- **Transmission rate**: continuous at ~50Hz (20ms interval), per Hue best practices
- **Packet format**: HueStream v2 -- 16-byte header + 36-byte entertainment config UUID + 7 bytes per channel (channel ID + RGB16 big-endian)
- **Always transmits**: sends current state every 20ms even when values have not changed (compensates for UDP packet loss)
- **Bridge decimation**: Hue bridge decimates to 25Hz over ZigBee
- **Visible effect rate**: should stay below 12.5Hz; the adapter reports ~6Hz to the bridge core as the rate limit for value changes
- **Limits**: max 10 lights per entertainment area, one active entertainment area per bridge

Lights in the active entertainment area are automatically excluded from REST API control and reported as `controlMode: "realtime"`.

### Standard REST API (Limited)

Rate-limited HTTP calls to the Hue CLIP v2 API for lights, groups, and scenes.

- Lights: individual color/state control
- Groups (rooms, zones): brightness control via grouped_light resource
- Scenes: activation by scene ID

All REST calls use HTTPS with self-signed certificate handling (Hue bridges use a private CA).

## Entertainment Area Selection

Configure the entertainment area via `protocolConfig.entertainmentConfigId` in the bridge config:

```json
{
  "protocolConfig": {
    "entertainmentConfigId": "uuid-of-entertainment-area"
  }
}
```

When an entertainment area is active:
- Lights assigned to that area switch to `controlMode: "realtime"`
- These lights are auto-excluded from REST API control
- All other lights remain as `controlMode: "limited"`

Entertainment areas are configured in the Hue app. Each area can contain up to 10 lights. Only one area per bridge can be active at a time (Hue hardware limitation).

## Rate Limits

| Category | Max/sec | Default/sec | Notes |
|----------|---------|-------------|-------|
| `light` | 10 | 10 | ~100ms gap between individual light REST calls |
| `group` | 1 | 1 | Group state changes (rooms, zones) |
| `scene` | 1 | 1 | Scene activation (internally a group-level operation) |

These follow Hue API guidelines (~10 commands/sec to `/lights`, max 1/sec to `/groups`). The bridge core enforces the shared budget per category per bridge.

Users can lower these limits in the bridge config but not exceed the maximum:

```json
"rateLimits": {
  "light": 5
}
```

## Channel Modes

| Mode | Channels | Layout | Use Case |
|------|----------|--------|----------|
| `8bit` | 3 | R, G, B (0-255) | Standard color control |
| `8bit-dimmable` | 4 | Dim, R, G, B (0-255) | Color + separate dimmer |
| `16bit` | 6 | R-coarse, R-fine, G-coarse, G-fine, B-coarse, B-fine | High-precision color |
| `scene-selector` | 1 | 0 = no action, 1-255 maps to scene list | Scene triggering |
| `brightness` | 1 | 0-255 | Group brightness control |

All values are normalized to 16-bit (0-65535) by the bridge core before reaching the adapter.

## Configuration Examples

### Basic Setup: Three Lights in 8-bit RGB

```json
{
  "id": "hue-studio",
  "protocol": "hue",
  "connection": {
    "host": "192.168.1.42",
    "username": "abc123",
    "clientkey": "def456"
  },
  "universe": 0,
  "channelMappings": [
    { "targetId": "light-1-uuid", "targetType": "light", "dmxStart": 1, "channelMode": "8bit" },
    { "targetId": "light-2-uuid", "targetType": "light", "dmxStart": 4, "channelMode": "8bit" },
    { "targetId": "light-3-uuid", "targetType": "light", "dmxStart": 7, "channelMode": "8bit" }
  ]
}
```

### Entertainment Streaming with 16-bit Color

```json
{
  "id": "hue-stage",
  "protocol": "hue",
  "connection": {
    "host": "192.168.1.42",
    "username": "abc123",
    "clientkey": "def456"
  },
  "universe": 0,
  "protocolConfig": {
    "entertainmentConfigId": "ent-area-uuid"
  },
  "channelMappings": [
    { "targetId": "light-1-uuid", "targetType": "light", "dmxStart": 1, "channelMode": "16bit" },
    { "targetId": "light-2-uuid", "targetType": "light", "dmxStart": 7, "channelMode": "16bit" }
  ]
}
```

### Mixed: Lights + Group Brightness + Scene Selector

```json
{
  "id": "hue-living-room",
  "protocol": "hue",
  "connection": {
    "host": "192.168.1.42",
    "username": "abc123",
    "clientkey": "def456"
  },
  "universe": 0,
  "channelMappings": [
    { "targetId": "light-1-uuid", "targetType": "light", "dmxStart": 1, "channelMode": "8bit-dimmable" },
    { "targetId": "group-1-uuid", "targetType": "group", "dmxStart": 5, "channelMode": "brightness" },
    { "targetId": "scene-sel-uuid", "targetType": "scene-selector", "dmxStart": 6, "channelMode": "scene-selector" }
  ],
  "rateLimits": {
    "light": 8
  }
}
```

## Hue CLIP v2 Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/clip/v2/resource/light` | GET | List lights |
| `/clip/v2/resource/light/{id}` | PUT | Set light state |
| `/clip/v2/resource/room` | GET | List rooms |
| `/clip/v2/resource/zone` | GET | List zones |
| `/clip/v2/resource/grouped_light` | GET | List grouped lights |
| `/clip/v2/resource/grouped_light/{id}` | PUT | Set group state |
| `/clip/v2/resource/scene` | GET | List scenes |
| `/clip/v2/resource/scene/{id}` | PUT | Activate scene |
| `/clip/v2/resource/entertainment_configuration` | GET | List entertainment areas |
| `/clip/v2/resource/entertainment_configuration/{id}` | PUT | Start/stop streaming |
| `/api` | POST | Create app user (pairing) |

## Internal Components

- `HueProtocolAdapter` -- main adapter class, implements `ProtocolAdapter`
- `HueClipClient` -- thin CLIP v2 REST client using native `fetch`
- `HueDtlsStream` -- DTLS streaming via `node-dtls-client`, continuous 50Hz transmission
- `HueDiscovery` -- mDNS + Meethue cloud discovery
- `HuePairing` -- link-button pairing flow
