import * as dtls from "node-dtls-client";

// ---------------------------------------------------------------------------
// HueStream v2 packet constants
// ---------------------------------------------------------------------------

const HUESTREAM_HEADER = Buffer.from([
  0x48,
  0x75,
  0x65,
  0x53,
  0x74,
  0x72,
  0x65,
  0x61,
  0x6d, // "HueStream"
]);

/** Fixed header size: 9 (magic) + 2 (version) + 1 (seq) + 2 (reserved) + 1 (color space) + 1 (reserved) = 16 */
const HEADER_SIZE = 16;

/** Entertainment configuration UUID is always 36 ASCII characters */
const CONFIG_ID_SIZE = 36;

/** Each channel entry: 1 (id) + 2 (R) + 2 (G) + 2 (B) = 7 bytes */
const CHANNEL_ENTRY_SIZE = 7;

const PACKET_PREFIX_SIZE = HEADER_SIZE + CONFIG_ID_SIZE;

/** Hue Entertainment API DTLS port */
const HUE_DTLS_PORT = 2100;

/** Streaming interval in milliseconds (~50 Hz) */
const STREAM_INTERVAL_MS = 20;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ColorUpdate {
  channelId: number;
  color: [number, number, number]; // [R, G, B] each 0–65535
}

// ---------------------------------------------------------------------------
// Packet construction (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Build a HueStream v2 packet for the given entertainment configuration
 * and channel color updates.
 *
 * @param entertainmentConfigId 36-character UUID of the entertainment configuration
 * @param updates Per-channel color updates
 * @returns Complete HueStream v2 packet ready to send over DTLS
 */
export function buildHueStreamPacket(
  entertainmentConfigId: string,
  updates: ReadonlyArray<ColorUpdate>,
): Buffer {
  if (entertainmentConfigId.length !== CONFIG_ID_SIZE) {
    throw new Error(
      `entertainmentConfigId must be exactly 36 characters, got ${String(entertainmentConfigId.length)}`,
    );
  }

  const packet = Buffer.alloc(PACKET_PREFIX_SIZE + updates.length * CHANNEL_ENTRY_SIZE, 0x00);

  // Bytes 0-8: "HueStream"
  HUESTREAM_HEADER.copy(packet, 0);

  // Byte 9: API major version 2
  packet.writeUInt8(0x02, 9);

  // Byte 10: API minor version 0
  packet.writeUInt8(0x00, 10);

  // Byte 11: Sequence number (currently ignored, use 0)
  packet.writeUInt8(0x00, 11);

  // Bytes 12-13: Reserved
  packet.writeUInt16BE(0x0000, 12);

  // Byte 14: Color space (0x00 = RGB)
  packet.writeUInt8(0x00, 14);

  // Byte 15: Reserved
  packet.writeUInt8(0x00, 15);

  // Bytes 16-51: Entertainment configuration UUID (36 ASCII chars)
  packet.write(entertainmentConfigId, 16, 36, "ascii");

  // Bytes 52+: Per-channel data
  let offset = PACKET_PREFIX_SIZE;
  for (const update of updates) {
    packet.writeUInt8(update.channelId & 0xff, offset);
    packet.writeUInt16BE(update.color[0], offset + 1);
    packet.writeUInt16BE(update.color[1], offset + 3);
    packet.writeUInt16BE(update.color[2], offset + 5);
    offset += CHANNEL_ENTRY_SIZE;
  }

  return packet;
}

// ---------------------------------------------------------------------------
// Reconnection constants
// ---------------------------------------------------------------------------

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;

// ---------------------------------------------------------------------------
// Event callback types
// ---------------------------------------------------------------------------

export interface DtlsStreamCallbacks {
  /** Called when the DTLS connection drops unexpectedly. */
  onDisconnected?: () => void;
  /**
   * Called before each reconnection attempt. The adapter should re-activate
   * the entertainment configuration via REST before returning.  If the
   * callback rejects, the reconnection attempt is skipped (but retried
   * after the next backoff interval).
   */
  onReconnecting?: (attemptNumber: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// HueDtlsStream
// ---------------------------------------------------------------------------

/**
 * Manages a DTLS connection to a Philips Hue bridge for entertainment
 * streaming.  On `connect()`, opens a DTLS 1.2 / PSK session and starts a
 * 50 Hz loop that continuously transmits the current color state.
 *
 * If the connection drops, the stream will automatically attempt to
 * reconnect with exponential backoff (1s, 2s, 4s, … up to 30s).  The
 * streaming interval keeps running so that values resume sending
 * immediately upon reconnection.
 */
export class HueDtlsStream {
  private readonly host: string;
  private readonly pskIdentity: string;
  private readonly clientKey: string;
  private readonly entertainmentConfigId: string;
  private readonly callbacks: DtlsStreamCallbacks;

  private socket: dtls.dtls.Socket | null = null;
  private streamInterval: ReturnType<typeof setInterval> | null = null;
  private _connected = false;
  private _closed = false;
  private _reconnecting = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;

  /** Current per-channel color state, keyed by channel ID */
  private readonly channelColors = new Map<number, [number, number, number]>();

  constructor(
    host: string,
    pskIdentity: string,
    clientKey: string,
    entertainmentConfigId: string,
    callbacks?: DtlsStreamCallbacks,
  ) {
    if (entertainmentConfigId.length !== CONFIG_ID_SIZE) {
      throw new Error(
        `entertainmentConfigId must be exactly 36 characters, got ${String(entertainmentConfigId.length)}`,
      );
    }
    this.host = host;
    this.pskIdentity = pskIdentity;
    this.clientKey = clientKey;
    this.entertainmentConfigId = entertainmentConfigId;
    this.callbacks = callbacks ?? {};
  }

  /** Whether the stream is currently connected and sending. */
  get connected(): boolean {
    return this._connected;
  }

  /** Whether the stream is currently attempting to reconnect. */
  get reconnecting(): boolean {
    return this._reconnecting;
  }

  /**
   * Open the DTLS connection and start the 50 Hz streaming loop.
   * Resolves once the DTLS handshake has completed.
   */
  async connect(): Promise<void> {
    if (this._connected) {
      return;
    }

    this._closed = false;
    await this.openSocket();

    // Start the 50 Hz streaming loop (keeps running even when disconnected)
    if (this.streamInterval === null) {
      this.streamInterval = setInterval(() => {
        this.sendCurrentState();
      }, STREAM_INTERVAL_MS);
    }
  }

  /**
   * Update the color values for one or more channels.
   * The new values will be picked up by the next streaming tick.
   */
  updateValues(updates: ReadonlyArray<ColorUpdate>): void {
    for (const update of updates) {
      this.channelColors.set(update.channelId, [update.color[0], update.color[1], update.color[2]]);
    }
  }

  /**
   * Stop streaming and close the DTLS connection permanently.
   * No reconnection will be attempted after this call.
   */
  async close(): Promise<void> {
    this._closed = true;
    this._reconnecting = false;
    this.reconnectAttempt = 0;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.streamInterval !== null) {
      clearInterval(this.streamInterval);
      this.streamInterval = null;
    }

    this._connected = false;
    const socket = this.socket;
    if (socket) {
      this.socket = null;
      await new Promise<void>((resolve) => {
        socket.close(() => resolve());
      });
    }
  }

  // -----------------------------------------------------------------------
  // Private — socket management
  // -----------------------------------------------------------------------

  private async openSocket(): Promise<void> {
    const pskBuffer = Buffer.from(this.clientKey, "hex");

    const socket = await new Promise<dtls.dtls.Socket>((resolve, reject) => {
      const pskRecord: Record<string, string> = {};
      // node-dtls-client types declare psk values as string but the
      // implementation accepts Buffers.  We store the hex-decoded buffer's
      // latin1 representation so the bytes pass through unchanged.
      pskRecord[this.pskIdentity] = pskBuffer.toString("latin1");

      const s = dtls.dtls.createSocket({
        type: "udp4",
        address: this.host,
        port: HUE_DTLS_PORT,
        psk: pskRecord,
        ciphers: ["TLS_PSK_WITH_AES_128_GCM_SHA256"],
        timeout: 5000,
      });

      s.on("connected", () => resolve(s));
      s.on("error", (err: Error) => reject(err));
    });

    this.socket = socket;
    this._connected = true;
    this._reconnecting = false;
    this.reconnectAttempt = 0;

    // Handle unexpected close / error while streaming
    socket.on("close", () => {
      this.handleDisconnect();
    });
    socket.on("error", () => {
      this.handleDisconnect();
    });
  }

  private handleDisconnect(): void {
    this._connected = false;
    this.socket = null;

    // Don't reconnect if close() was called intentionally
    if (this._closed) {
      return;
    }

    this.callbacks.onDisconnected?.();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this._closed || this._reconnecting) {
      return;
    }

    this._reconnecting = true;
    const delay = Math.min(
      INITIAL_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, this.reconnectAttempt),
      MAX_BACKOFF_MS,
    );
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.attemptReconnect();
    }, delay);
  }

  private async attemptReconnect(): Promise<void> {
    if (this._closed) {
      this._reconnecting = false;
      return;
    }

    try {
      // Notify adapter so it can re-activate entertainment config via REST
      if (this.callbacks.onReconnecting) {
        await this.callbacks.onReconnecting(this.reconnectAttempt);
      }

      await this.openSocket();
    } catch {
      // Reconnection failed — try again with increased backoff
      if (!this._closed) {
        this._reconnecting = false;
        this.scheduleReconnect();
      }
    }
  }

  // -----------------------------------------------------------------------
  // Private — packet sending
  // -----------------------------------------------------------------------

  private sendCurrentState(): void {
    if (!this._connected || !this.socket) {
      return;
    }

    const updates: ColorUpdate[] = [];
    for (const [channelId, color] of this.channelColors) {
      updates.push({ channelId, color });
    }

    const packet = buildHueStreamPacket(this.entertainmentConfigId, updates);
    this.socket.send(packet);
  }
}
