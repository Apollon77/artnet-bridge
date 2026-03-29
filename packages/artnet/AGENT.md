# ArtNet Package -- Agent Context

## Key files

| File | Purpose |
|------|---------|
| `src/constants.ts` | Protocol constants (header, opcodes, port 6454, version 14) |
| `src/packets.ts` | Packet parser and serializers for OpOutput, OpPoll, OpPollReply |
| `src/ArtNetReceiver.ts` | UDP listener, emits typed events (`dmx`, `poll`, `packet`, `error`) |
| `src/ArtNetSender.ts` | UDP sender for DMX packets and polls |

## Packet format

All Art-Net packets start with:
- Header: `"Art-Net\0"` (8 bytes, `[0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00]`)
- Opcode: 2 bytes, **little-endian** (at bytes 8-9)
- Protocol version: 14, **big-endian** (at bytes 10-11)

### OpOutput (ArtDmx) -- 0x5000

DMX data packet. Layout after the common header:

| Offset | Size | Field | Endian |
|--------|------|-------|--------|
| 12 | 1 | Sequence (0 = disabled) | -- |
| 13 | 1 | Physical port | -- |
| 14 | 1 | SubUni (universe low byte) | -- |
| 15 | 1 | Net (universe high byte, bits 14-8) | -- |
| 16 | 2 | Data length | Big-endian |
| 18 | N | DMX channel data | -- |

Universe = `(Net << 8) | SubUni`. Data length must be even, range 2-512 bytes.

### OpPoll -- 0x2000

Discovery request. 14 bytes minimum. The receiver auto-replies with OpPollReply when `autoReplyToPoll` is true (default).

### OpPollReply -- 0x2100

Node identity report. 239 bytes. Contains IP address, short/long name, port types, universe assignments, MAC address.

**Important**: PollReply is sent to port 6454 (the Art-Net port), NOT to the sender's ephemeral port. The receiver also broadcasts for visibility.

## Universe addressing

- Art-Net universe is **0-based**, 15-bit (0-32767)
- `MAX_PORT_ADDRESS = 0x7FFF`
- Up to 4 output ports per node (Art-Net spec limit)
- The receiver reports configured output universes via `setOutputUniverses()`

## Partial frames

Controllers may send fewer than 512 bytes of DMX data. The `BridgeOrchestrator` accumulates these into a full 512-byte buffer per universe. The ArtNet package itself does not buffer -- it passes the raw data through.

## ArtNetSender -- waitReady()

The sender socket bind is async. Sends before bind completes are silently dropped (the `bound` flag prevents them). In tests, always call `await sender.waitReady()` before sending:

```typescript
const sender = new ArtNetSender({ targetAddress: "127.0.0.1" });
await sender.waitReady();
sender.sendDmx(0, data);
```

## Tests

- `test/PacketTest.ts` -- Packet serialization/parsing round-trips
- `test/RoundtripTest.ts` -- Full send/receive integration test

Tests use the `build/esm/test/` output directory (mocha config in root `.mocharc.yml`).
