# @artnet-bridge/artnet

Art-Net protocol implementation for Node.js. Zero external dependencies -- uses only `node:dgram`.

## What This Package Does

Implements the Art-Net protocol for sending and receiving DMX data over UDP. Supports the core opcodes needed for DMX bridging:

- `OpOutput` (0x5000) -- DMX data
- `OpPoll` (0x2000) -- discovery poll
- `OpPollReply` (0x2100) -- reply to polls

Packet formats follow the Art-Net specification (reference PDF at `docs/art-net.pdf`).

## ArtNetReceiver

Listens for Art-Net UDP packets and emits typed events.

```typescript
import { ArtNetReceiver } from "@artnet-bridge/artnet";

const receiver = new ArtNetReceiver({
  bindAddress: "0.0.0.0",  // default
  port: 6454,              // default (Art-Net standard port)
});

receiver.on("dmx", (universe, data) => {
  // universe: 0-based universe number
  // data: Uint8Array of up to 512 DMX channel values
  console.log(`Universe ${universe}: channel 1 = ${data[0]}`);
});

receiver.on("poll", (info) => {
  console.log(`Poll from ${info.address}:${info.port}`);
});

receiver.on("error", (err) => {
  console.error("Receiver error:", err);
});

await receiver.start();

// Later:
await receiver.stop();
```

### Events

| Event | Arguments | Description |
|-------|-----------|-------------|
| `dmx` | `(universe: number, data: Uint8Array)` | DMX data received |
| `poll` | `(info: { address, port })` | ArtPoll received |
| `packet` | `(packet: ArtNetPacket, rinfo)` | Any valid Art-Net packet |
| `error` | `(error: Error)` | Socket error |

## ArtNetSender

Sends Art-Net UDP packets. Useful both as a production component and as a test simulator.

```typescript
import { ArtNetSender } from "@artnet-bridge/artnet";

const sender = new ArtNetSender({
  targetAddress: "255.255.255.255",  // default (broadcast)
  port: 6454,                        // default
});

// Send DMX data
const dmxData = new Uint8Array(512);
dmxData[0] = 255;  // Channel 1 = full
dmxData[1] = 128;  // Channel 2 = half
sender.sendDmx(0, dmxData);  // universe 0

// Send a poll
sender.sendPoll();

// Clean up
sender.close();
```

### API

| Method | Description |
|--------|-------------|
| `sendDmx(universe, data, sequence?)` | Send an OpOutput packet. Sequence 0 = disabled. |
| `sendPoll()` | Send an OpPoll packet |
| `close()` | Close the UDP socket |

## Low-Level Packet Functions

For direct packet construction and parsing:

```typescript
import {
  parsePacket,
  serializeDmxPacket,
  serializePollPacket,
  serializePollReplyPacket,
} from "@artnet-bridge/artnet";
```

## Protocol Compliance

- Art-Net header validation ("Art-Net\0")
- Protocol version field (14)
- 15-bit Port-Address for universe numbering
- DMX data length: 2-512 bytes, even-padded per spec

## Usage as Test Simulator

`ArtNetSender` works as a standalone DMX simulator for testing. Point it at localhost or a specific IP to feed test data into an `ArtNetReceiver`:

```typescript
const sender = new ArtNetSender({ targetAddress: "127.0.0.1" });
const data = new Uint8Array(512);

// Ramp channel 1 from 0 to 255
for (let i = 0; i <= 255; i++) {
  data[0] = i;
  sender.sendDmx(0, data);
  await new Promise(resolve => setTimeout(resolve, 20));
}

sender.close();
```
