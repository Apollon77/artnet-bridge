# Hue Protocol Adapter -- Agent Context

## Key files

| File | Purpose |
|------|---------|
| `src/HueClipClient.ts` | Thin CLIP v2 REST client (12 endpoints). Self-signed cert handling. |
| `src/HueDtlsStream.ts` | Entertainment DTLS streaming at 50Hz with auto-reconnect. |
| `src/HueProtocolAdapter.ts` | Main adapter. Entity mapping, value dispatch, color conversion. |
| `src/HueDiscovery.ts` | Bridge discovery via `discovery.meethue.com` (nUPnP). |
| `src/HuePairing.ts` | Link-button pairing with polling loop. |
| `src/web/HueWebHandlers.ts` | Protocol-specific web routes mounted at `/protocol/hue/`. |
| `src/web/hue-config.html` | Entertainment area selection UI (static HTML). |

## Entertainment streaming

### Channel member resolution (CRITICAL)

Entertainment configuration channel members reference **entertainment service IDs**, NOT light IDs. To find the actual light:

```
entertainment service --> owner device (owner.rid) --> light with same owner device
```

The adapter builds this lookup in `connect()`:
```typescript
const entServiceToLight = new Map<string, HueLight>();
for (const svc of entertainmentServices) {
  if (svc.owner?.rid) {
    const light = lights.find((l) => l.owner?.rid === svc.owner.rid);
    if (light) entServiceToLight.set(svc.id, light);
  }
}
```

You must call `getEntertainmentServices()` and build this map. Without it, entertainment channel members cannot be resolved to their actual lights.

### Streaming behavior

- Stream at 50Hz continuously via DTLS, even when values are unchanged (UDP loss compensation)
- Hue bridge decimates to 25Hz over ZigBee; visible effect rate is under 12.5Hz
- Only one streaming session per bridge at a time. If another client claims it, the adapter retries every 30 seconds.
- Entertainment lights are always color-capable (Hue requirement for entertainment areas)
- Color space: raw RGB16 (0-65535) in the HueStream v2 packet (no xy conversion needed for streaming)

### DTLS connection

- DTLS 1.2 with PSK, cipher `TLS_PSK_WITH_AES_128_GCM_SHA256`, port 2100
- PSK identity = application ID from `/auth/v1` response header `hue-application-id`
- PSK key = clientkey from pairing (hex-encoded)
- Auto-reconnect with exponential backoff (1s, 2s, 4s, ... up to 30s)
- On reconnect, must re-activate entertainment config via REST (`startEntertainment()`) before DTLS handshake

### node-dtls-client PSK workaround

The `node-dtls-client` types declare PSK values as `string`, but the implementation actually accepts `Buffer`. We encode the hex clientkey via latin1 so bytes pass through unchanged:

```typescript
const pskBuffer = Buffer.from(this.clientKey, "hex");
pskRecord[this.pskIdentity] = pskBuffer.toString("latin1");
```

This is a known issue: `AlCalzone/node-dtls-client#460`.

### HueStream v2 packet format

Built by `buildHueStreamPacket()` in `HueDtlsStream.ts`:
- Bytes 0-8: `"HueStream"` (9 bytes)
- Byte 9: API major version (2)
- Byte 10: API minor version (0)
- Byte 11: Sequence (0)
- Bytes 12-13: Reserved
- Byte 14: Color space (0x00 = RGB)
- Byte 15: Reserved
- Bytes 16-51: Entertainment config UUID (36 ASCII chars)
- Bytes 52+: Per-channel entries, each 7 bytes: `channelId(1) + R(2) + G(2) + B(2)`, all big-endian 16-bit

## REST API (CLIP v2)

### Turning lights on/off

Lights must be explicitly turned ON before color/brightness changes take effect:
```typescript
// Turn on with color
await setter(entityId, {
  on: { on: true },
  color: { xy: { x, y } },
  dimming: { brightness: Math.max(bri, 1) },
});

// Turn off
await setter(entityId, { on: { on: false } });
```

All-zero RGB values = turn light OFF. Brightness minimum is 1% when on (Hue rejects 0% with `on: true`).

### Rate limits

| Category | Limit | Notes |
|----------|-------|-------|
| light | 10/sec | Shared across all lights on one bridge. 100ms gap. |
| group | 1/sec | Grouped light state changes |
| scene | 1/sec | Scene activations (group-scoped operation) |
| realtime-light | 6/sec | Entertainment streaming value change rate |

The adapter handles 429 responses with a 1-second backoff window (`rateLimitBackoffUntil`).

### Scenes

Scenes are always group-scoped. Activating a scene affects ALL lights in the group, not just selected ones. Groups can override individual light state.

### Self-signed certificates

Hue bridges use self-signed certs. `HueClipClient` uses `rejectUnauthorized: false` in all HTTPS requests.

## Color conversion

For REST API (not entertainment streaming): RGB16 (0-65535) is converted to CIE xy + brightness:

```
sRGB gamma decode --> XYZ matrix (Wide RGB D65) --> xy chromaticity
```

Function: `rgb16ToXyBrightness()` in `HueProtocolAdapter.ts`. Returns `{ x, y, bri }` where bri is 0-100.

## Bridge pairing

`pairWithBridge()` in `HuePairing.ts`:
- Polls every 2 seconds for up to 30 seconds
- Waits for user to press the physical link button on the bridge
- Returns `{ username, clientkey }` -- clientkey is needed for entertainment DTLS
- Credentials are auto-saved to config by the CLI and web route handlers

## Dependency injection

`HueProtocolAdapter` accepts optional dependency overrides in constructor for testing:
- `createClipClient` -- factory for HueClipClient
- `createDtlsStream` -- factory for HueDtlsStream
- `discoverFn` -- discovery function
- `pairFn` -- pairing function

## Error handling

- Network errors (ECONNREFUSED, ETIMEDOUT, etc.): mark bridge disconnected, retry every 30s
- 429 Too Many Requests: back off for 1 second
- Other HTTP errors: log warning and skip (do not crash)
- Entertainment area claimed by another client: retry every 30 seconds
