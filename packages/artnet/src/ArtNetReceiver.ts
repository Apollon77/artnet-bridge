/**
 * ArtNetReceiver listens for Art-Net UDP packets and emits typed events.
 */

import { createSocket, type Socket } from "node:dgram";
import { EventEmitter } from "node:events";
import { ARTNET_PORT } from "./constants.js";
import { type ArtNetPacket, parsePacket } from "./packets.js";

export interface ArtNetReceiverOptions {
  /** Address to bind to (default: "0.0.0.0") */
  bindAddress?: string;
  /** UDP port to listen on (default: 6454) */
  port?: number;
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

export class ArtNetReceiver extends (EventEmitter as new () => EventEmitter & TypedEmitter) {
  private readonly bindAddress: string;
  private readonly port: number;
  private socket: Socket | undefined;

  constructor(options?: ArtNetReceiverOptions) {
    super();
    this.bindAddress = options?.bindAddress ?? "0.0.0.0";
    this.port = options?.port ?? ARTNET_PORT;
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
