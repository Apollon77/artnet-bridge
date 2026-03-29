/**
 * ArtNetReceiver listens for Art-Net UDP packets and emits typed events.
 */

import { createSocket, type Socket } from "node:dgram";
import { networkInterfaces } from "node:os";
import { EventEmitter } from "node:events";
import { ARTNET_PORT } from "./constants.js";
import { type ArtNetPacket, parsePacket, serializePollReplyPacket } from "./packets.js";

export interface ArtNetReceiverOptions {
  /** Address to bind to (default: "0.0.0.0") */
  bindAddress?: string;
  /** UDP port to listen on (default: 6454) */
  port?: number;
  /** Whether to automatically reply to OpPoll packets (default: true) */
  autoReplyToPoll?: boolean;
  /** Short name for OpPollReply (default: "ArtNet Bridge", max 17 chars) */
  shortName?: string;
  /** Long name for OpPollReply (default: "ArtNet Bridge", max 63 chars) */
  longName?: string;
  /** Output universes to report in OpPollReply (up to 4 ports) */
  outputUniverses?: number[];
}

export interface ArtNetReceiverEvents {
  dmx: [universe: number, data: Uint8Array];
  poll: [info: { address: string; port: number }];
  packet: [packet: ArtNetPacket, rinfo: { address: string; port: number }];
  error: [error: Error];
}

type TypedEmitter = {
  on<K extends keyof ArtNetReceiverEvents>(
    event: K,
    listener: (...args: ArtNetReceiverEvents[K]) => void,
  ): TypedEmitter;
  emit<K extends keyof ArtNetReceiverEvents>(event: K, ...args: ArtNetReceiverEvents[K]): boolean;
  off<K extends keyof ArtNetReceiverEvents>(
    event: K,
    listener: (...args: ArtNetReceiverEvents[K]) => void,
  ): TypedEmitter;
  once<K extends keyof ArtNetReceiverEvents>(
    event: K,
    listener: (...args: ArtNetReceiverEvents[K]) => void,
  ): TypedEmitter;
};

/**
 * Get the first non-loopback IPv4 address as a 4-tuple.
 * Falls back to 0.0.0.0 if none found.
 */
function getLocalIpAddress(): readonly [number, number, number, number] {
  const interfaces = networkInterfaces();
  for (const name in interfaces) {
    const ifaceList = interfaces[name];
    if (!ifaceList) continue;
    for (const iface of ifaceList) {
      if (iface.family === "IPv4" && !iface.internal) {
        const parts = iface.address.split(".").map(Number);
        if (parts.length === 4) {
          return [parts[0], parts[1], parts[2], parts[3]] as const;
        }
      }
    }
  }
  return [0, 0, 0, 0] as const;
}

export class ArtNetReceiver extends (EventEmitter as new () => EventEmitter & TypedEmitter) {
  private readonly bindAddress: string;
  private readonly port: number;
  private socket: Socket | undefined;
  /** Whether to automatically reply to OpPoll with an OpPollReply */
  readonly autoReplyToPoll: boolean;
  /** Short name reported in OpPollReply (max 17 chars) */
  readonly shortName: string;
  /** Long name reported in OpPollReply (max 63 chars) */
  readonly longName: string;
  /** Output universes reported in OpPollReply */
  private outputUniverses: number[];

  constructor(options?: ArtNetReceiverOptions) {
    super();
    this.bindAddress = options?.bindAddress ?? "0.0.0.0";
    this.port = options?.port ?? ARTNET_PORT;
    this.autoReplyToPoll = options?.autoReplyToPoll ?? true;
    this.shortName = options?.shortName ?? "ArtNet Bridge";
    this.longName = options?.longName ?? "ArtNet Bridge";
    this.outputUniverses = options?.outputUniverses ?? [];
  }

  /** Update the output universes reported in OpPollReply (can be called at runtime). */
  setOutputUniverses(universes: number[]): void {
    this.outputUniverses = universes.slice(0, 4); // ArtNet supports max 4 ports per node
  }

  /** Bind the UDP socket and start listening for Art-Net packets. */
  async start(): Promise<void> {
    if (this.socket) {
      throw new Error("ArtNetReceiver is already started");
    }

    const socket = createSocket({ type: "udp4", reuseAddr: true });
    this.socket = socket;

    socket.on("error", (err) => {
      this.emit("error", err);
    });

    socket.on("message", (msg, rinfo) => {
      const packet = parsePacket(Buffer.from(msg));
      if (!packet) return;

      this.emit("packet", packet, { address: rinfo.address, port: rinfo.port });

      switch (packet.opcode) {
        case 0x5000:
          this.emit("dmx", packet.universe, packet.data);
          break;
        case 0x2000:
          this.emit("poll", { address: rinfo.address, port: rinfo.port });
          if (this.autoReplyToPoll && this.socket) {
            // Per Art-Net spec, PollReply is sent to the Art-Net port (6454),
            // broadcast on the local network (or unicast to the sender's IP on port 6454)
            this.sendPollReply(rinfo.address, ARTNET_PORT);
          }
          break;
      }
    });

    return new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(this.port, this.bindAddress, () => {
        socket.removeListener("error", reject);
        resolve();
      });
    });
  }

  /** Send an OpPollReply to the given address on the Art-Net port. */
  private sendPollReply(address: string, port: number): void {
    const ipParts = getLocalIpAddress();
    console.log(
      `[ArtNet] Sending PollReply to ${address}:${port} (our IP: ${ipParts.join(".")}, ${this.outputUniverses.length} ports)`,
    );
    const numPorts = Math.min(this.outputUniverses.length, 4);

    // Port types: each port is output (bit 7 = output capable)
    const portTypes: readonly [number, number, number, number] = [
      numPorts > 0 ? 0x80 : 0, // port 0: output capable
      numPorts > 1 ? 0x80 : 0,
      numPorts > 2 ? 0x80 : 0,
      numPorts > 3 ? 0x80 : 0,
    ];

    // swOut: universe low byte per port
    const swOut: readonly [number, number, number, number] = [
      this.outputUniverses[0] !== undefined ? this.outputUniverses[0] & 0xff : 0,
      this.outputUniverses[1] !== undefined ? this.outputUniverses[1] & 0xff : 0,
      this.outputUniverses[2] !== undefined ? this.outputUniverses[2] & 0xff : 0,
      this.outputUniverses[3] !== undefined ? this.outputUniverses[3] & 0xff : 0,
    ];

    // Net and subnet from the first universe (simplified — all ports share net/sub)
    const firstUniverse = this.outputUniverses[0] ?? 0;
    const netSwitch = (firstUniverse >> 8) & 0x7f;
    const subSwitch = (firstUniverse >> 4) & 0x0f;

    // GoodOutputA: bit 7 = data being transmitted
    const goodOutputA: readonly [number, number, number, number] = [
      numPorts > 0 ? 0x80 : 0,
      numPorts > 1 ? 0x80 : 0,
      numPorts > 2 ? 0x80 : 0,
      numPorts > 3 ? 0x80 : 0,
    ];

    const reply = serializePollReplyPacket({
      ipAddress: ipParts,
      shortName: this.shortName,
      longName: this.longName,
      numPorts,
      portTypes,
      goodOutputA,
      swOut,
      netSwitch,
      subSwitch,
      style: 0x00, // StNode
      status1: 0xd0, // Indicators normal, Port-Address programming authority = network
      status2: 0x08, // supports Art-Net 3+, DHCP capable
    });
    // Send unicast to the requester AND broadcast for other listeners
    this.socket?.send(reply, 0, reply.length, port, address);
    // Also try broadcast so all controllers on the network see us
    try {
      this.socket?.setBroadcast(true);
      this.socket?.send(reply, 0, reply.length, port, "255.255.255.255");
    } catch {
      // Broadcast may not be available on all interfaces
    }
  }

  /** Close the UDP socket and stop receiving. */
  async stop(): Promise<void> {
    const socket = this.socket;
    if (!socket) return;
    this.socket = undefined;

    return new Promise<void>((resolve) => {
      socket.close(() => {
        resolve();
      });
    });
  }
}
