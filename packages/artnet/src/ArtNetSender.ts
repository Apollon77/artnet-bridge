/**
 * ArtNetSender sends Art-Net UDP packets to a target address.
 */

import { createSocket, type Socket } from "node:dgram";
import { ARTNET_PORT } from "./constants.js";
import { serializeDmxPacket, serializePollPacket } from "./packets.js";

export interface ArtNetSenderOptions {
  /** Target IP address (default: "255.255.255.255" broadcast) */
  targetAddress?: string;
  /** Target UDP port (default: 6454) */
  port?: number;
}

export class ArtNetSender {
  private readonly targetAddress: string;
  private readonly port: number;
  private readonly socket: Socket;
  private bound = false;

  constructor(options?: ArtNetSenderOptions) {
    this.targetAddress = options?.targetAddress ?? "255.255.255.255";
    this.port = options?.port ?? ARTNET_PORT;
    this.socket = createSocket({ type: "udp4", reuseAddr: true });

    // Prevent unhandled error crashes
    this.socket.on("error", (err) => console.error("[ArtNet] Sender socket error:", err.message));

    // setBroadcast requires the socket to be bound; bind to an ephemeral port first
    this.socket.bind(0, () => {
      this.socket.setBroadcast(true);
      this.bound = true;
    });
  }

  /**
   * Send an ArtDmx (OpOutput) packet.
   *
   * @param universe - 15-bit Port-Address
   * @param data     - DMX channel data (up to 512 bytes)
   * @param sequence - Sequence number (0 = disabled)
   */
  sendDmx(universe: number, data: Uint8Array, sequence = 0): void {
    if (!this.bound) return;
    const buf = serializeDmxPacket(universe, data, sequence);
    this.socket.send(buf, 0, buf.length, this.port, this.targetAddress);
  }

  /** Send an ArtPoll packet. */
  sendPoll(): void {
    if (!this.bound) return;
    const buf = serializePollPacket();
    this.socket.send(buf, 0, buf.length, this.port, this.targetAddress);
  }

  /** Close the underlying UDP socket. */
  close(): void {
    try {
      this.socket.close();
    } catch {
      // Already closed
    }
  }
}
