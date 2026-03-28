import * as assert from "node:assert/strict";
import { buildHueStreamPacket, HueDtlsStream } from "../src/HueDtlsStream.js";
import type { ColorUpdate } from "../src/HueDtlsStream.js";

// ---------------------------------------------------------------------------
// A valid 36-character UUID for testing
// ---------------------------------------------------------------------------

const VALID_CONFIG_ID = "01234567-89ab-cdef-0123-456789abcdef";

// ---------------------------------------------------------------------------
// buildHueStreamPacket — packet format tests
// ---------------------------------------------------------------------------

describe("buildHueStreamPacket", () => {
  it("should reject config IDs that are not 36 characters", () => {
    assert.throws(() => buildHueStreamPacket("too-short", []), /exactly 36 characters/);

    assert.throws(() => buildHueStreamPacket("a".repeat(37), []), /exactly 36 characters/);
  });

  it("should accept a 36-character config ID", () => {
    assert.doesNotThrow(() => buildHueStreamPacket(VALID_CONFIG_ID, []));
  });

  it("should produce correct header bytes for an empty update list", () => {
    const packet = buildHueStreamPacket(VALID_CONFIG_ID, []);

    // Total length: 16 header + 36 UUID + 0 channels = 52
    assert.equal(packet.length, 52);

    // Bytes 0-8: "HueStream"
    assert.equal(packet.toString("ascii", 0, 9), "HueStream");

    // Byte 9: major version 2
    assert.equal(packet.readUInt8(9), 0x02);

    // Byte 10: minor version 0
    assert.equal(packet.readUInt8(10), 0x00);

    // Byte 11: sequence number 0
    assert.equal(packet.readUInt8(11), 0x00);

    // Bytes 12-13: reserved 0x0000
    assert.equal(packet.readUInt16BE(12), 0x0000);

    // Byte 14: color space RGB = 0
    assert.equal(packet.readUInt8(14), 0x00);

    // Byte 15: reserved 0
    assert.equal(packet.readUInt8(15), 0x00);

    // Bytes 16-51: entertainment configuration UUID
    assert.equal(packet.toString("ascii", 16, 52), VALID_CONFIG_ID);
  });

  it("should encode single channel color data correctly", () => {
    const updates: ColorUpdate[] = [{ channelId: 0, color: [65535, 0, 32768] }];

    const packet = buildHueStreamPacket(VALID_CONFIG_ID, updates);

    // Total length: 52 + 7 = 59
    assert.equal(packet.length, 59);

    // Channel entry starts at byte 52
    assert.equal(packet.readUInt8(52), 0); // channel ID
    assert.equal(packet.readUInt16BE(53), 65535); // R
    assert.equal(packet.readUInt16BE(55), 0); // G
    assert.equal(packet.readUInt16BE(57), 32768); // B
  });

  it("should encode multiple channels in order", () => {
    const updates: ColorUpdate[] = [
      { channelId: 0, color: [100, 200, 300] },
      { channelId: 5, color: [1000, 2000, 3000] },
      { channelId: 9, color: [65535, 65535, 65535] },
    ];

    const packet = buildHueStreamPacket(VALID_CONFIG_ID, updates);

    // Total length: 52 + 3*7 = 73
    assert.equal(packet.length, 73);

    // Channel 0
    assert.equal(packet.readUInt8(52), 0);
    assert.equal(packet.readUInt16BE(53), 100);
    assert.equal(packet.readUInt16BE(55), 200);
    assert.equal(packet.readUInt16BE(57), 300);

    // Channel 5
    assert.equal(packet.readUInt8(59), 5);
    assert.equal(packet.readUInt16BE(60), 1000);
    assert.equal(packet.readUInt16BE(62), 2000);
    assert.equal(packet.readUInt16BE(64), 3000);

    // Channel 9
    assert.equal(packet.readUInt8(66), 9);
    assert.equal(packet.readUInt16BE(67), 65535);
    assert.equal(packet.readUInt16BE(69), 65535);
    assert.equal(packet.readUInt16BE(71), 65535);
  });

  it("should mask channel ID to a single byte", () => {
    const updates: ColorUpdate[] = [
      { channelId: 256, color: [0, 0, 0] }, // 256 & 0xff = 0
    ];

    const packet = buildHueStreamPacket(VALID_CONFIG_ID, updates);
    assert.equal(packet.readUInt8(52), 0);
  });
});

// ---------------------------------------------------------------------------
// HueDtlsStream constructor validation
// ---------------------------------------------------------------------------

describe("HueDtlsStream", () => {
  describe("constructor", () => {
    it("should reject config IDs that are not 36 characters", () => {
      assert.throws(
        () => new HueDtlsStream("192.168.1.1", "identity", "aabb", "short"),
        /exactly 36 characters/,
      );
    });

    it("should accept a valid 36-character config ID", () => {
      const stream = new HueDtlsStream("192.168.1.1", "identity", "aabb", VALID_CONFIG_ID);
      assert.equal(stream.connected, false);
    });
  });

  describe("updateValues()", () => {
    it("should not throw when updating values before connect", () => {
      const stream = new HueDtlsStream("192.168.1.1", "identity", "aabb", VALID_CONFIG_ID);

      assert.doesNotThrow(() => {
        stream.updateValues([{ channelId: 0, color: [100, 200, 300] }]);
      });
    });
  });
});
