import * as assert from "node:assert/strict";
import type { DmxChannelMapping, Entity } from "@artnet-bridge/protocol";
import { DmxMapper } from "../../src/dmx/DmxMapper.js";

function makeEntity(id: string, layoutType: "rgb" | "rgb-dimmable" | "brightness"): Entity;
function makeEntity(
  id: string,
  layoutType: "scene-selector",
  scenes: Array<{ index: number; sceneId: string; name: string }>,
): Entity;
function makeEntity(
  id: string,
  layoutType: string,
  scenes?: Array<{ index: number; sceneId: string; name: string }>,
): Entity {
  let channelLayout;
  switch (layoutType) {
    case "rgb":
      channelLayout = { type: "rgb" as const };
      break;
    case "rgb-dimmable":
      channelLayout = { type: "rgb-dimmable" as const };
      break;
    case "brightness":
      channelLayout = { type: "brightness" as const };
      break;
    case "scene-selector":
      channelLayout = { type: "scene-selector" as const, scenes: scenes ?? [] };
      break;
    default:
      throw new Error(`Unknown layout type: ${layoutType}`);
  }

  return {
    id,
    metadata: { name: id, type: "light" },
    controlMode: "limited",
    category: "light",
    channelLayout,
  };
}

function makeMapping(
  targetId: string,
  dmxStart: number,
  channelMode: DmxChannelMapping["channelMode"],
): DmxChannelMapping {
  return { targetId, targetType: "light", dmxStart, channelMode };
}

function dmxFrame(...bytes: number[]): Uint8Array {
  const frame = new Uint8Array(512);
  for (let i = 0; i < bytes.length; i++) {
    frame[i] = bytes[i];
  }
  return frame;
}

describe("DmxMapper", () => {
  describe("8bit extraction", () => {
    it("normalizes RGB bytes by multiplying by 257", () => {
      const entity = makeEntity("light1", "rgb");
      const mapping = makeMapping("light1", 1, "8bit");
      const mapper = new DmxMapper([{ bridgeId: "bridge1", universe: 1, entity, mapping }]);

      const results = mapper.extractValues(1, dmxFrame(100, 200, 50));

      assert.equal(results.length, 1);
      assert.deepEqual(results[0].value, {
        type: "rgb",
        r: 100 * 257,
        g: 200 * 257,
        b: 50 * 257,
      });
    });
  });

  describe("8bit-dimmable extraction", () => {
    it("normalizes Dim, R, G, B bytes to 0-65535", () => {
      const entity = makeEntity("light1", "rgb-dimmable");
      const mapping = makeMapping("light1", 1, "8bit-dimmable");
      const mapper = new DmxMapper([{ bridgeId: "bridge1", universe: 1, entity, mapping }]);

      const results = mapper.extractValues(1, dmxFrame(128, 100, 200, 50));

      assert.equal(results.length, 1);
      assert.deepEqual(results[0].value, {
        type: "rgb-dimmable",
        dim: 128 * 257,
        r: 100 * 257,
        g: 200 * 257,
        b: 50 * 257,
      });
    });
  });

  describe("16bit extraction", () => {
    it("combines coarse/fine bytes into 16-bit values", () => {
      const entity = makeEntity("light1", "rgb");
      const mapping = makeMapping("light1", 1, "16bit");
      const mapper = new DmxMapper([{ bridgeId: "bridge1", universe: 1, entity, mapping }]);

      const results = mapper.extractValues(1, dmxFrame(0x80, 0x00, 0xff, 0xff, 0x00, 0x01));

      assert.equal(results.length, 1);
      assert.deepEqual(results[0].value, {
        type: "rgb",
        r: 32768,
        g: 65535,
        b: 1,
      });
    });
  });

  describe("scene-selector extraction", () => {
    const scenes = [
      { index: 1, sceneId: "scene-a", name: "Scene A" },
      { index: 2, sceneId: "scene-b", name: "Scene B" },
      { index: 5, sceneId: "scene-c", name: "Scene C" },
    ];

    it("returns undefined for DMX value 0 (no action)", () => {
      const entity = makeEntity("scene1", "scene-selector", scenes);
      const mapping = makeMapping("scene1", 1, "scene-selector");
      const mapper = new DmxMapper([{ bridgeId: "bridge1", universe: 1, entity, mapping }]);

      const results = mapper.extractValues(1, dmxFrame(0));

      assert.equal(results.length, 0);
    });

    it("looks up sceneId for matching DMX value", () => {
      const entity = makeEntity("scene1", "scene-selector", scenes);
      const mapping = makeMapping("scene1", 1, "scene-selector");
      const mapper = new DmxMapper([{ bridgeId: "bridge1", universe: 1, entity, mapping }]);

      const results = mapper.extractValues(1, dmxFrame(1));

      assert.equal(results.length, 1);
      assert.deepEqual(results[0].value, {
        type: "scene-selector",
        sceneId: "scene-a",
      });
    });

    it("returns undefined for DMX value not in scene list", () => {
      const entity = makeEntity("scene1", "scene-selector", scenes);
      const mapping = makeMapping("scene1", 1, "scene-selector");
      const mapper = new DmxMapper([{ bridgeId: "bridge1", universe: 1, entity, mapping }]);

      const results = mapper.extractValues(1, dmxFrame(99));

      assert.equal(results.length, 0);
    });
  });

  describe("brightness extraction", () => {
    it("normalizes byte 255 to 65535", () => {
      const entity = makeEntity("light1", "brightness");
      const mapping = makeMapping("light1", 1, "brightness");
      const mapper = new DmxMapper([{ bridgeId: "bridge1", universe: 1, entity, mapping }]);

      const results = mapper.extractValues(1, dmxFrame(255));

      assert.equal(results.length, 1);
      assert.deepEqual(results[0].value, {
        type: "brightness",
        value: 255 * 257,
      });
    });
  });

  describe("multiple entities from same DMX frame", () => {
    it("extracts values for all mapped entities", () => {
      const entity1 = makeEntity("light1", "rgb");
      const mapping1 = makeMapping("light1", 1, "8bit");
      const entity2 = makeEntity("light2", "brightness");
      const mapping2 = makeMapping("light2", 4, "brightness");
      const mapper = new DmxMapper([
        { bridgeId: "bridge1", universe: 1, entity: entity1, mapping: mapping1 },
        { bridgeId: "bridge1", universe: 1, entity: entity2, mapping: mapping2 },
      ]);

      const results = mapper.extractValues(1, dmxFrame(100, 150, 200, 128));

      assert.equal(results.length, 2);
      assert.equal(results[0].entityId, "light1");
      assert.equal(results[1].entityId, "light2");
    });
  });

  describe("entity on different universe", () => {
    it("returns empty array for unmatched universe", () => {
      const entity = makeEntity("light1", "rgb");
      const mapping = makeMapping("light1", 1, "8bit");
      const mapper = new DmxMapper([{ bridgeId: "bridge1", universe: 1, entity, mapping }]);

      const results = mapper.extractValues(2, dmxFrame(100, 200, 50));

      assert.equal(results.length, 0);
    });
  });

  describe("bounds check", () => {
    it("returns undefined when dmxStart + width exceeds data length", () => {
      const entity = makeEntity("light1", "rgb");
      const mapping = makeMapping("light1", 511, "8bit"); // needs 3 bytes at 510-512, but frame is 512

      // 8bit at dmxStart=511 needs indices 510, 511, 512 (0-based), but data.length=512 means max index is 511
      const mapper = new DmxMapper([{ bridgeId: "bridge1", universe: 1, entity, mapping }]);

      const shortData = new Uint8Array(512);
      const results = mapper.extractValues(1, shortData);

      // dmxStart=511 (0-based 510), width=3, 510+3=513 > 512 => undefined
      assert.equal(results.length, 0);
    });
  });

  describe("1-based to 0-based conversion", () => {
    it("dmxStart=1 reads data[0]", () => {
      const entity = makeEntity("light1", "brightness");
      const mapping = makeMapping("light1", 1, "brightness");
      const mapper = new DmxMapper([{ bridgeId: "bridge1", universe: 1, entity, mapping }]);

      const data = new Uint8Array(512);
      data[0] = 42;

      const results = mapper.extractValues(1, data);

      assert.equal(results.length, 1);
      assert.deepEqual(results[0].value, {
        type: "brightness",
        value: 42 * 257,
      });
    });
  });
});
