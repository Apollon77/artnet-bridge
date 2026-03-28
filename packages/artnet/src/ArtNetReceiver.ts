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

  constructor(options?: ArtNetReceiverOptions) {
    super();
    this.bindAddress = options?.bindAddress ?? "0.0.0.0";
    this.port = options?.port ?? ARTNET_PORT;
    this.autoReplyToPoll = options?.autoReplyToPoll ?? true;
    this.shortName = options?.shortName ?? "ArtNet Bridge";
    this.longName = options?.longName ?? "ArtNet Bridge";
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
            this.sendPollReply(rinfo.address, rinfo.port);
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

  /** Send an OpPollReply to the given address. */
  private sendPollReply(address: string, port: number): void {
    const ipParts = getLocalIpAddress();
    const reply = serializePollReplyPacket({
      ipAddress: ipParts,
      shortName: this.shortName,
      longName: this.longName,
      numPorts: 0,
      style: 0x00, // StNode
    });
    this.socket?.send(reply, 0, reply.length, port, address);
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
