# Web UI

## Accessing the UI

The web UI starts by default on port 8080. Open `http://localhost:8080` in a browser.

Change the port with `--port <number>` or in the config file under `web.port`. Disable the UI entirely with `--no-web` or `web.enabled: false`.

## Compact View (Default)

The default view shows a compact overview of the system:

- All configured bridges with connection status
- Entity count per bridge (realtime vs limited)
- ArtNet frame rate per active universe
- Link to protocol-specific pages per bridge (if the adapter registered web handlers)
- No live per-entity data by default (to keep bandwidth low)

## Detail Panels

Click a bridge to expand its detail panel. This shows:

- Per-entity status: current RGB/state, last update timestamp, control mode badge ("realtime" or "limited")
- Rate limit budget usage per category (e.g., "lights: 8/10 req/s used")
- DTLS streaming stats for realtime bridges (packets sent, connection state)
- Debug test controls: solid color buttons to send values directly (bypasses ArtNet, useful for testing)

Detail panels are loaded on demand. Entity data is only pushed to the client for bridges with an active subscription.

## WebSocket Protocol

The UI uses a WebSocket connection for live status updates. The subscription model keeps traffic minimal: no data is pushed unless the client subscribes to specific bridges.

### Messages

Client to server:

```json
{ "type": "subscribe", "bridgeId": "hue-living-room" }
```

```json
{ "type": "unsubscribe", "bridgeId": "hue-living-room" }
```

Server to client (status updates for subscribed bridges):

```json
{ "type": "status", "bridgeId": "hue-living-room", "data": { "connected": true, "streaming": true, "stats": {} } }
```

Server to client (ArtNet stats):

```json
{ "type": "artnet", "data": { "universes": { "0": { "fps": 40 } } } }
```

All messages carry a `type` discriminator. The server pushes status updates at approximately 2Hz (500ms interval) for subscribed bridges.

## Config Editing

The web UI provides REST endpoints for configuration management:

- View current config
- Add/edit/remove bridge configurations
- Update channel mappings
- Changes are written to the config file with file locking to prevent conflicts with CLI operations

See the [Configuration](configuration.md) docs for the full schema.
