import * as assert from "node:assert/strict";
import {
  ARTNET_HEADER,
  MAX_DMX_LENGTH,
  OP_OUTPUT,
  OP_POLL,
  OP_POLL_REPLY,
  PROTOCOL_VERSION,
} from "../src/constants.js";
import {
  parsePacket,
  serializeDmxPacket,
  serializePollPacket,
  serializePollReplyPacket,
} from "../src/packets.js";

describe("Art-Net Packet Parsing", () => {
  // -----------------------------------------------------------------------
  // OpOutput / ArtDmx
  // -----------------------------------------------------------------------

  describe("ArtDmx (OpOutput 0x5000)", () => {
    it("should parse a valid OpOutput packet", () => {
      const data = new Uint8Array([100, 200]);
      const buf = serializeDmxPacket(0, data, 1);
      const pkt = parsePacket(buf);

      assert.ok(pkt);
      assert.equal(pkt.opcode, OP_OUTPUT);
      if (pkt.opcode !== OP_OUTPUT) return; // narrow type
      assert.equal(pkt.protocolVersion, PROTOCOL_VERSION);
      assert.equal(pkt.sequence, 1);
      assert.equal(pkt.universe, 0);
      assert.equal(pkt.data[0], 100);
      assert.equal(pkt.data[1], 200);
    });

    it("should serialize then parse (roundtrip) preserving all fields", () => {
      const original = new Uint8Array(512);
      for (let i = 0; i < 512; i++) original[i] = i & 0xff;

      const buf = serializeDmxPacket(300, original, 42, 3);
      const pkt = parsePacket(buf);

      assert.ok(pkt);
      assert.equal(pkt.opcode, OP_OUTPUT);
      if (pkt.opcode !== OP_OUTPUT) return;
      assert.equal(pkt.protocolVersion, PROTOCOL_VERSION);
      assert.equal(pkt.sequence, 42);
      assert.equal(pkt.physical, 3);
      assert.equal(pkt.universe, 300);
      assert.equal(pkt.data.length, 512);
      for (let i = 0; i < 512; i++) {
        assert.equal(pkt.data[i], i & 0xff, `channel ${i}`);
      }
    });

    it("should encode universe 0 correctly", () => {
      const buf = serializeDmxPacket(0, new Uint8Array(2));
      assert.equal(buf[14], 0); // SubUni
      assert.equal(buf[15], 0); // Net
    });

    it("should encode universe 1 correctly", () => {
      const buf = serializeDmxPacket(1, new Uint8Array(2));
      assert.equal(buf[14], 1); // SubUni
      assert.equal(buf[15], 0); // Net
    });

    it("should encode universe 255 correctly", () => {
      const buf = serializeDmxPacket(255, new Uint8Array(2));
      assert.equal(buf[14], 0xff); // SubUni
      assert.equal(buf[15], 0); // Net
    });

    it("should encode universe 256 (high byte) correctly", () => {
      const buf = serializeDmxPacket(256, new Uint8Array(2));
      assert.equal(buf[14], 0); // SubUni
      assert.equal(buf[15], 1); // Net
    });

    it("should encode max universe (32767) correctly", () => {
      const buf = serializeDmxPacket(0x7fff, new Uint8Array(2));
      assert.equal(buf[14], 0xff); // SubUni
      assert.equal(buf[15], 0x7f); // Net (top 7 bits)
    });

    it("should pad odd-length data to even length", () => {
      const data = new Uint8Array(3);
      data[0] = 10;
      data[1] = 20;
      data[2] = 30;
      const buf = serializeDmxPacket(0, data);
      const length = buf.readUInt16BE(16);
      assert.equal(length % 2, 0, "data length must be even");
      assert.equal(length, 4);
    });

    it("should enforce minimum data length of 2", () => {
      const buf = serializeDmxPacket(0, new Uint8Array(0));
      const length = buf.readUInt16BE(16);
      assert.ok(length >= 2, `data length ${length} should be >= 2`);
    });

    it("should clamp data length to 512", () => {
      const oversized = new Uint8Array(600);
      const buf = serializeDmxPacket(0, oversized);
      const length = buf.readUInt16BE(16);
      assert.ok(length <= MAX_DMX_LENGTH, `data length ${length} should be <= 512`);
    });
  });

  // -----------------------------------------------------------------------
  // Invalid packets
  // -----------------------------------------------------------------------

  describe("Invalid packets", () => {
    it("should return undefined for empty buffer", () => {
      assert.equal(parsePacket(Buffer.alloc(0)), undefined);
    });

    it("should return undefined for truncated packet (too short for header)", () => {
      assert.equal(parsePacket(Buffer.alloc(5)), undefined);
    });

    it("should return undefined for wrong magic header", () => {
      const buf = Buffer.alloc(20);
      buf.write("NotArt!\0", 0, "ascii");
      buf.writeUInt16LE(OP_OUTPUT, 8);
      assert.equal(parsePacket(buf), undefined);
    });

    it("should return undefined for unknown opcode", () => {
      const buf = Buffer.alloc(20);
      ARTNET_HEADER.copy(buf, 0);
      buf.writeUInt16LE(0xffff, 8);
      assert.equal(parsePacket(buf), undefined);
    });

    it("should return undefined for ArtDmx with truncated data", () => {
      const buf = serializeDmxPacket(0, new Uint8Array(100));
      const truncated = buf.subarray(0, 20);
      assert.equal(parsePacket(truncated), undefined);
    });

    it("should return undefined for ArtDmx with odd data length in header", () => {
      const buf = Buffer.alloc(21);
      ARTNET_HEADER.copy(buf, 0);
      buf.writeUInt16LE(OP_OUTPUT, 8);
      buf.writeUInt16BE(PROTOCOL_VERSION, 10);
      buf.writeUInt16BE(3, 16); // odd length = 3 (invalid)
      assert.equal(parsePacket(buf), undefined);
    });

    it("should return undefined for ArtDmx with data length > 512", () => {
      const buf = Buffer.alloc(18 + 514);
      ARTNET_HEADER.copy(buf, 0);
      buf.writeUInt16LE(OP_OUTPUT, 8);
      buf.writeUInt16BE(PROTOCOL_VERSION, 10);
      buf.writeUInt16BE(514, 16); // > 512
      assert.equal(parsePacket(buf), undefined);
    });

    it("should return undefined for ArtDmx with data length < 2", () => {
      const buf = Buffer.alloc(18);
      ARTNET_HEADER.copy(buf, 0);
      buf.writeUInt16LE(OP_OUTPUT, 8);
      buf.writeUInt16BE(PROTOCOL_VERSION, 10);
      buf.writeUInt16BE(0, 16); // length 0
      assert.equal(parsePacket(buf), undefined);
    });
  });

  // -----------------------------------------------------------------------
  // OpPoll
  // -----------------------------------------------------------------------

  describe("ArtPoll (OpPoll 0x2000)", () => {
    it("should parse a valid OpPoll packet", () => {
      const buf = serializePollPacket();
      const pkt = parsePacket(buf);

      assert.ok(pkt);
      assert.equal(pkt.opcode, OP_POLL);
      if (pkt.opcode !== OP_POLL) return;
      assert.equal(pkt.protocolVersion, PROTOCOL_VERSION);
      assert.equal(pkt.flags, 0);
    });

    it("should roundtrip OpPoll with flags", () => {
      const buf = serializePollPacket(0x06);
      const pkt = parsePacket(buf);

      assert.ok(pkt);
      assert.equal(pkt.opcode, OP_POLL);
      if (pkt.opcode !== OP_POLL) return;
      assert.equal(pkt.flags, 0x06);
    });

    it("should return undefined for truncated OpPoll", () => {
      const buf = serializePollPacket();
      const truncated = buf.subarray(0, 11);
      assert.equal(parsePacket(truncated), undefined);
    });
  });

  // -----------------------------------------------------------------------
  // OpPollReply
  // -----------------------------------------------------------------------

  describe("ArtPollReply (OpPollReply 0x2100)", () => {
    it("should serialize and parse a PollReply packet", () => {
      const buf = serializePollReplyPacket({
        ipAddress: [10, 0, 0, 1],
        shortName: "TestNode",
        longName: "Test Node Long Name",
        numPorts: 1,
        netSwitch: 0,
        subSwitch: 0,
        swOut: [1, 0, 0, 0],
      });

      const pkt = parsePacket(buf);
      assert.ok(pkt);
      assert.equal(pkt.opcode, OP_POLL_REPLY);
      if (pkt.opcode !== OP_POLL_REPLY) return;
      assert.deepEqual(pkt.ipAddress, [10, 0, 0, 1]);
      assert.equal(pkt.port, 0x1936);
      assert.equal(pkt.shortName, "TestNode");
      assert.equal(pkt.longName, "Test Node Long Name");
      assert.equal(pkt.numPorts, 1);
      assert.deepEqual(pkt.swOut, [1, 0, 0, 0]);
    });

    it("should return undefined for truncated PollReply", () => {
      const buf = serializePollReplyPacket();
      const truncated = buf.subarray(0, 50);
      assert.equal(parsePacket(truncated), undefined);
    });
  });
});
