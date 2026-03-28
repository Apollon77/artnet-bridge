/**
 * Art-Net packet types, parser, and serializers.
 *
 * Packet formats are defined by the Art-Net 4 specification.
 * All opcodes are transmitted little-endian; protocol version is big-endian.
 */

import {
  ARTNET_HEADER,
  MAX_DMX_LENGTH,
  MIN_DMX_LENGTH,
  OP_OUTPUT,
  OP_POLL,
  OP_POLL_REPLY,
  PROTOCOL_VERSION,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Packet types
// ---------------------------------------------------------------------------

export interface ArtDmxPacket {
  opcode: typeof OP_OUTPUT;
  protocolVersion: number;
  sequence: number;
  physical: number;
  /** 15-bit Port-Address (Net[14:8] + SubUni[7:0]) */
  universe: number;
  /** DMX channel data, up to 512 bytes */
  data: Uint8Array;
}

export interface ArtPollPacket {
  opcode: typeof OP_POLL;
  protocolVersion: number;
  flags: number;
}

export interface PollReplyOptions {
  ipAddress?: readonly [number, number, number, number];
  firmwareVersion?: number;
  netSwitch?: number;
  subSwitch?: number;
  oem?: number;
  status1?: number;
  estaMan?: number;
  shortName?: string;
  longName?: string;
  nodeReport?: string;
  numPorts?: number;
  portTypes?: readonly [number, number, number, number];
  goodInput?: readonly [number, number, number, number];
  goodOutputA?: readonly [number, number, number, number];
  swIn?: readonly [number, number, number, number];
  swOut?: readonly [number, number, number, number];
  style?: number;
  macAddress?: readonly [number, number, number, number, number, number];
  status2?: number;
}

export interface ArtPollReplyPacket {
  opcode: typeof OP_POLL_REPLY;
  ipAddress: readonly [number, number, number, number];
  port: number;
  firmwareVersion: number;
  netSwitch: number;
  subSwitch: number;
  oem: number;
  status1: number;
  estaMan: number;
  shortName: string;
  longName: string;
  nodeReport: string;
  numPorts: number;
  portTypes: readonly [number, number, number, number];
  goodInput: readonly [number, number, number, number];
  goodOutputA: readonly [number, number, number, number];
  swIn: readonly [number, number, number, number];
  swOut: readonly [number, number, number, number];
  style: number;
  macAddress: readonly [number, number, number, number, number, number];
  status2: number;
}

export type ArtNetPacket = ArtDmxPacket | ArtPollPacket | ArtPollReplyPacket;

// ---------------------------------------------------------------------------
// Header validation
// ---------------------------------------------------------------------------

/** Read a null-terminated ASCII string from a buffer region. */
function readNullTerminatedString(buf: Buffer, start: number, end: number): string {
  const slice = buf.subarray(start, end);
  const nullIndex = slice.indexOf(0);
  const length = nullIndex === -1 ? slice.length : nullIndex;
  return buf.toString("ascii", start, start + length);
}

function hasValidHeader(buf: Buffer): boolean {
  if (buf.length < 10) return false;
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== ARTNET_HEADER[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseDmx(buf: Buffer): ArtDmxPacket | undefined {
  // Minimum: 8 (header) + 2 (opcode) + 2 (version) + 1 (seq) + 1 (phys) + 2 (universe) + 2 (length) = 18
  if (buf.length < 18) return undefined;

  const protocolVersion = buf.readUInt16BE(10);
  const sequence = buf[12];
  const physical = buf[13];
  const subUni = buf[14];
  const net = buf[15];
  const universe = (net << 8) | subUni;
  const dataLength = buf.readUInt16BE(16);

  if (dataLength < MIN_DMX_LENGTH || dataLength > MAX_DMX_LENGTH) return undefined;
  if (dataLength % 2 !== 0) return undefined;
  if (buf.length < 18 + dataLength) return undefined;

  const data = new Uint8Array(buf.buffer, buf.byteOffset + 18, dataLength);

  return {
    opcode: OP_OUTPUT,
    protocolVersion,
    sequence,
    physical,
    universe,
    data: new Uint8Array(data), // defensive copy
  };
}

function parsePoll(buf: Buffer): ArtPollPacket | undefined {
  // Minimum: 8 (header) + 2 (opcode) + 2 (version) + 2 (flags + diagPriority) = 14
  if (buf.length < 14) return undefined;

  const protocolVersion = buf.readUInt16BE(10);
  const flags = buf[12];

  return {
    opcode: OP_POLL,
    protocolVersion,
    flags,
  };
}

function parsePollReply(buf: Buffer): ArtPollReplyPacket | undefined {
  // ArtPollReply minimum is 207 bytes per spec but we only parse what we need
  // Minimum we require: 8 (ID) + 2 (opcode) + 4 (IP) + 2 (port) + ... = at least ~197
  if (buf.length < 197) return undefined;

  const ipAddress = [buf[10], buf[11], buf[12], buf[13]] as const;
  const port = buf.readUInt16LE(14);
  const firmwareVersion = buf.readUInt16BE(16);
  const netSwitch = buf[18];
  const subSwitch = buf[19];
  const oem = buf.readUInt16BE(20);
  // byte 22 = ubea
  const status1 = buf[23];
  const estaMan = buf.readUInt16LE(24);
  const shortName = readNullTerminatedString(buf, 26, 44);
  const longName = readNullTerminatedString(buf, 44, 108);
  const nodeReport = readNullTerminatedString(buf, 108, 172);
  const numPorts = buf.readUInt16BE(172);
  const portTypes = [buf[174], buf[175], buf[176], buf[177]] as const;
  const goodInput = [buf[178], buf[179], buf[180], buf[181]] as const;
  const goodOutputA = [buf[182], buf[183], buf[184], buf[185]] as const;
  const swIn = [buf[186], buf[187], buf[188], buf[189]] as const;
  const swOut = [buf[190], buf[191], buf[192], buf[193]] as const;
  // bytes 194..196 = swVideo (deprecated), swMacro, swRemote
  const style = buf[196];

  let macAddress: readonly [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  if (buf.length >= 207) {
    macAddress = [buf[201], buf[202], buf[203], buf[204], buf[205], buf[206]] as const;
  }

  let status2 = 0;
  if (buf.length >= 212) {
    status2 = buf[211];
  }

  return {
    opcode: OP_POLL_REPLY,
    ipAddress,
    port,
    firmwareVersion,
    netSwitch,
    subSwitch,
    oem,
    status1,
    estaMan,
    shortName,
    longName,
    nodeReport,
    numPorts,
    portTypes,
    goodInput,
    goodOutputA,
    swIn,
    swOut,
    style,
    macAddress,
    status2,
  };
}

// ---------------------------------------------------------------------------
// Public parser
// ---------------------------------------------------------------------------

/**
 * Parse an incoming Art-Net UDP packet buffer.
 * Returns undefined for invalid or unsupported packets.
 */
export function parsePacket(buffer: Buffer): ArtNetPacket | undefined {
  if (!hasValidHeader(buffer)) return undefined;

  // Opcode is at bytes 8-9, little-endian
  const opcode = buffer.readUInt16LE(8);

  switch (opcode) {
    case OP_OUTPUT:
      return parseDmx(buffer);
    case OP_POLL:
      return parsePoll(buffer);
    case OP_POLL_REPLY:
      return parsePollReply(buffer);
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

/**
 * Create an ArtDmx (OpOutput 0x5000) packet buffer.
 *
 * @param universe - 15-bit Port-Address (0..32767)
 * @param data     - DMX channel data (up to 512 bytes)
 * @param sequence - Sequence counter (0 = disabled, 1-255 for ordering)
 * @param physical - Physical port number (default 0)
 */
export function serializeDmxPacket(
  universe: number,
  data: Uint8Array,
  sequence = 0,
  physical = 0,
): Buffer {
  let length = data.length;

  // Enforce even length per spec
  if (length % 2 !== 0) {
    length += 1;
  }

  // Clamp to valid range
  length = Math.max(MIN_DMX_LENGTH, Math.min(MAX_DMX_LENGTH, length));

  const buf = Buffer.alloc(18 + length);

  // Field 1: Header "Art-Net\0"
  ARTNET_HEADER.copy(buf, 0);

  // Field 2: OpCode (little-endian)
  buf.writeUInt16LE(OP_OUTPUT, 8);

  // Field 3-4: Protocol version (big-endian)
  buf.writeUInt16BE(PROTOCOL_VERSION, 10);

  // Field 5: Sequence
  buf[12] = sequence & 0xff;

  // Field 6: Physical
  buf[13] = physical & 0xff;

  // Field 7: SubUni (low byte of Port-Address)
  buf[14] = universe & 0xff;

  // Field 8: Net (high byte of Port-Address, bits 14-8)
  buf[15] = (universe >> 8) & 0x7f;

  // Field 9-10: Length (big-endian)
  buf.writeUInt16BE(length, 16);

  // Field 11: DMX data
  const copyLen = Math.min(data.length, length);
  buf.set(data.subarray(0, copyLen), 18);

  return buf;
}

/**
 * Create an ArtPoll (OpPoll 0x2000) packet buffer.
 *
 * @param flags - TalkToMe flags byte (default 0)
 */
export function serializePollPacket(flags = 0): Buffer {
  // ArtPoll: 8 (ID) + 2 (opcode) + 2 (version) + 1 (flags) + 1 (diagPriority) = 14 minimum
  // Full packet per spec includes targeting fields: +2+2+2+2+2 = 24 total with EstaMan/Oem
  const buf = Buffer.alloc(14);

  ARTNET_HEADER.copy(buf, 0);
  buf.writeUInt16LE(OP_POLL, 8);
  buf.writeUInt16BE(PROTOCOL_VERSION, 10);
  buf[12] = flags & 0xff;
  buf[13] = 0; // DiagPriority: DpAll

  return buf;
}

/**
 * Create an ArtPollReply (OpPollReply 0x2100) packet buffer.
 *
 * The ArtPollReply is a large, mostly zero-filled packet. We populate the
 * most commonly used fields from the options.
 */
export function serializePollReplyPacket(options: PollReplyOptions = {}): Buffer {
  // ArtPollReply is 239 bytes per the full spec
  const buf = Buffer.alloc(239);

  // Field 1: Header
  ARTNET_HEADER.copy(buf, 0);

  // Field 2: OpCode (little-endian)
  buf.writeUInt16LE(OP_POLL_REPLY, 8);

  // Field 3: IP Address (4 bytes, big-endian order)
  if (options.ipAddress) {
    buf[10] = options.ipAddress[0];
    buf[11] = options.ipAddress[1];
    buf[12] = options.ipAddress[2];
    buf[13] = options.ipAddress[3];
  }

  // Field 4: Port (always 0x1936 = 6454), little-endian
  buf.writeUInt16LE(0x1936, 14);

  // Field 5-6: Firmware version (big-endian)
  buf.writeUInt16BE(options.firmwareVersion ?? 0, 16);

  // Field 7: NetSwitch
  buf[18] = options.netSwitch ?? 0;

  // Field 8: SubSwitch
  buf[19] = options.subSwitch ?? 0;

  // Field 9: OEM (big-endian)
  buf.writeUInt16BE(options.oem ?? 0x00ff, 20);

  // Field 10 (byte 22): UBEA version = 0
  buf[22] = 0;

  // Field 11: Status1
  buf[23] = options.status1 ?? 0;

  // Field 12: ESTA manufacturer (little-endian)
  buf.writeUInt16LE(options.estaMan ?? 0, 24);

  // Field 13: Short Name (18 bytes, null-terminated)
  if (options.shortName) {
    buf.write(options.shortName.substring(0, 17), 26, "ascii");
  }

  // Field 14: Long Name (64 bytes, null-terminated)
  if (options.longName) {
    buf.write(options.longName.substring(0, 63), 44, "ascii");
  }

  // Field 15: Node Report (64 bytes, null-terminated)
  if (options.nodeReport) {
    buf.write(options.nodeReport.substring(0, 63), 108, "ascii");
  }

  // Field 16: NumPorts (big-endian)
  buf.writeUInt16BE(options.numPorts ?? 0, 172);

  // Field 17: PortTypes[4]
  if (options.portTypes) {
    for (let i = 0; i < 4; i++) buf[174 + i] = options.portTypes[i];
  }

  // Field 18: GoodInput[4]
  if (options.goodInput) {
    for (let i = 0; i < 4; i++) buf[178 + i] = options.goodInput[i];
  }

  // Field 19: GoodOutputA[4]
  if (options.goodOutputA) {
    for (let i = 0; i < 4; i++) buf[182 + i] = options.goodOutputA[i];
  }

  // Field 20: SwIn[4]
  if (options.swIn) {
    for (let i = 0; i < 4; i++) buf[186 + i] = options.swIn[i];
  }

  // Field 21: SwOut[4]
  if (options.swOut) {
    for (let i = 0; i < 4; i++) buf[190 + i] = options.swOut[i];
  }

  // Bytes 194-196: SwVideo (deprecated), SwMacro, SwRemote = 0

  // Field 22: Style
  buf[196] = options.style ?? 0x00; // StNode

  // Field 23: MAC address (6 bytes at offset 201)
  // Bytes 197-200: spare
  if (options.macAddress) {
    for (let i = 0; i < 6; i++) buf[201 + i] = options.macAddress[i];
  }

  // Byte 207-210: BindIp = 0
  // Byte 211: BindIndex = 0

  // Field: Status2
  buf[211] = options.status2 ?? 0;

  return buf;
}
