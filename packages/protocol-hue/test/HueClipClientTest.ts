import * as assert from "node:assert/strict";
import { HueClipClient } from "../src/HueClipClient.js";

// ---------------------------------------------------------------------------
// Testable subclass — override the protected HTTP methods for unit testing
// ---------------------------------------------------------------------------

interface MockResponse {
  status: number;
  headers?: Record<string, string>;
  body: string;
}

/** Records requests and returns canned responses. */
class TestableHueClipClient extends HueClipClient {
  readonly requests: Array<{
    method: string;
    resource: string;
    body?: Record<string, unknown>;
  }> = [];

  private nextResponse: MockResponse = { status: 200, body: '{"data":[],"errors":[]}' };

  setNextResponse(response: MockResponse): void {
    this.nextResponse = response;
  }

  protected override async clipGet<T>(resource: string): Promise<T[]> {
    this.requests.push({ method: "GET", resource });
    const res = this.nextResponse;
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Hue API error: ${String(res.status)} ${res.body}`);
    }
    const parsed = JSON.parse(res.body) as { data: T[] };
    return parsed.data;
  }

  protected override async clipPut(resource: string, body: Record<string, unknown>): Promise<void> {
    this.requests.push({ method: "PUT", resource, body });
    const res = this.nextResponse;
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Hue API error: ${String(res.status)} ${res.body}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HueClipClient", () => {
  let client: TestableHueClipClient;

  beforeEach(() => {
    client = new TestableHueClipClient("192.168.1.100", "test-app-key");
  });

  // --- Resource getters ---------------------------------------------------

  describe("getLights()", () => {
    it("should return parsed light list", async () => {
      client.setNextResponse({
        status: 200,
        body: JSON.stringify({
          errors: [],
          data: [
            { id: "abc-123", metadata: { name: "Desk lamp" }, type: "light" },
            { id: "def-456", metadata: { name: "Ceiling" }, type: "light" },
          ],
        }),
      });

      const lights = await client.getLights();
      assert.equal(lights.length, 2);
      assert.equal(lights[0].id, "abc-123");
      assert.equal(lights[0].metadata.name, "Desk lamp");
      assert.equal(lights[1].id, "def-456");

      assert.equal(client.requests.length, 1);
      assert.equal(client.requests[0].method, "GET");
      assert.equal(client.requests[0].resource, "light");
    });
  });

  describe("getRooms()", () => {
    it("should return parsed room list with children", async () => {
      client.setNextResponse({
        status: 200,
        body: JSON.stringify({
          errors: [],
          data: [
            {
              id: "room-1",
              metadata: { name: "Living room" },
              type: "room",
              children: [{ rid: "light-1", rtype: "light" }],
              services: [{ rid: "gl-1", rtype: "grouped_light" }],
            },
          ],
        }),
      });

      const rooms = await client.getRooms();
      assert.equal(rooms.length, 1);
      assert.equal(rooms[0].id, "room-1");
      assert.equal(rooms[0].metadata.name, "Living room");
      assert.equal(rooms[0].children.length, 1);
      assert.equal(rooms[0].children[0].rid, "light-1");
      assert.equal(rooms[0].services[0].rtype, "grouped_light");

      assert.equal(client.requests[0].resource, "room");
    });
  });

  describe("getGroupedLights()", () => {
    it("should return parsed list", async () => {
      client.setNextResponse({
        status: 200,
        body: JSON.stringify({
          errors: [],
          data: [{ id: "gl-1", owner: { rid: "room-1", rtype: "room" }, type: "grouped_light" }],
        }),
      });

      const grouped = await client.getGroupedLights();
      assert.equal(grouped.length, 1);
      assert.equal(grouped[0].id, "gl-1");
      assert.equal(grouped[0].owner.rid, "room-1");

      assert.equal(client.requests[0].resource, "grouped_light");
    });
  });

  describe("getScenes()", () => {
    it("should return parsed scene list", async () => {
      client.setNextResponse({
        status: 200,
        body: JSON.stringify({
          errors: [],
          data: [
            {
              id: "scene-1",
              metadata: { name: "Relax" },
              group: { rid: "room-1", rtype: "room" },
              type: "scene",
            },
          ],
        }),
      });

      const scenes = await client.getScenes();
      assert.equal(scenes.length, 1);
      assert.equal(scenes[0].metadata.name, "Relax");
      assert.equal(scenes[0].group.rid, "room-1");

      assert.equal(client.requests[0].resource, "scene");
    });
  });

  describe("getEntertainmentConfigurations()", () => {
    it("should return parsed list", async () => {
      client.setNextResponse({
        status: 200,
        body: JSON.stringify({
          errors: [],
          data: [
            {
              id: "ent-1",
              metadata: { name: "TV area" },
              type: "entertainment_configuration",
              status: "inactive",
              channels: [
                {
                  channel_id: 0,
                  position: { x: 0, y: 0, z: 0 },
                  members: [{ service: { rid: "light-1", rtype: "light" }, index: 0 }],
                },
              ],
            },
          ],
        }),
      });

      const configs = await client.getEntertainmentConfigurations();
      assert.equal(configs.length, 1);
      assert.equal(configs[0].id, "ent-1");
      assert.equal(configs[0].status, "inactive");
      assert.equal(configs[0].channels.length, 1);
      assert.equal(configs[0].channels[0].channel_id, 0);
      assert.equal(configs[0].channels[0].members[0].service.rid, "light-1");

      assert.equal(client.requests[0].resource, "entertainment_configuration");
    });
  });

  describe("getZones()", () => {
    it("should return parsed zone list", async () => {
      client.setNextResponse({
        status: 200,
        body: JSON.stringify({
          errors: [],
          data: [
            {
              id: "zone-1",
              metadata: { name: "Upstairs" },
              type: "zone",
              children: [{ rid: "light-2", rtype: "light" }],
              services: [],
            },
          ],
        }),
      });

      const zones = await client.getZones();
      assert.equal(zones.length, 1);
      assert.equal(zones[0].metadata.name, "Upstairs");
      assert.equal(client.requests[0].resource, "zone");
    });
  });

  // --- State setters ------------------------------------------------------

  describe("setLightState()", () => {
    it("should send correct PUT body", async () => {
      client.setNextResponse({ status: 200, body: '{"data":[],"errors":[]}' });

      await client.setLightState("light-1", { on: { on: true }, dimming: { brightness: 80 } });

      assert.equal(client.requests.length, 1);
      assert.equal(client.requests[0].method, "PUT");
      assert.equal(client.requests[0].resource, "light/light-1");
      assert.deepEqual(client.requests[0].body, { on: { on: true }, dimming: { brightness: 80 } });
    });
  });

  describe("setGroupedLightState()", () => {
    it("should send correct PUT body", async () => {
      client.setNextResponse({ status: 200, body: '{"data":[],"errors":[]}' });

      await client.setGroupedLightState("gl-1", { on: { on: false } });

      assert.equal(client.requests[0].method, "PUT");
      assert.equal(client.requests[0].resource, "grouped_light/gl-1");
      assert.deepEqual(client.requests[0].body, { on: { on: false } });
    });
  });

  describe("activateScene()", () => {
    it("should send correct PUT with recall action", async () => {
      client.setNextResponse({ status: 200, body: '{"data":[],"errors":[]}' });

      await client.activateScene("scene-1");

      assert.equal(client.requests[0].method, "PUT");
      assert.equal(client.requests[0].resource, "scene/scene-1");
      assert.deepEqual(client.requests[0].body, { recall: { action: "active" } });
    });
  });

  // --- Entertainment ------------------------------------------------------

  describe("startEntertainment()", () => {
    it("should send correct PUT with start action", async () => {
      client.setNextResponse({ status: 200, body: '{"data":[],"errors":[]}' });

      await client.startEntertainment("ent-1");

      assert.equal(client.requests[0].method, "PUT");
      assert.equal(client.requests[0].resource, "entertainment_configuration/ent-1");
      assert.deepEqual(client.requests[0].body, { action: "start" });
    });
  });

  describe("stopEntertainment()", () => {
    it("should send correct PUT with stop action", async () => {
      client.setNextResponse({ status: 200, body: '{"data":[],"errors":[]}' });

      await client.stopEntertainment("ent-1");

      assert.equal(client.requests[0].method, "PUT");
      assert.equal(client.requests[0].resource, "entertainment_configuration/ent-1");
      assert.deepEqual(client.requests[0].body, { action: "stop" });
    });
  });

  // --- Error handling -----------------------------------------------------

  describe("error handling", () => {
    it("should throw on non-2xx GET response", async () => {
      client.setNextResponse({ status: 403, body: "Forbidden" });

      await assert.rejects(
        () => client.getLights(),
        (err: Error) => {
          assert.ok(err.message.includes("403"));
          return true;
        },
      );
    });

    it("should throw on non-2xx PUT response", async () => {
      client.setNextResponse({ status: 500, body: "Internal Server Error" });

      await assert.rejects(
        () => client.setLightState("light-1", { on: { on: true } }),
        (err: Error) => {
          assert.ok(err.message.includes("500"));
          return true;
        },
      );
    });
  });
});
