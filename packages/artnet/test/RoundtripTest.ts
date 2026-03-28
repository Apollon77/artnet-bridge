import * as assert from "node:assert/strict";
import { ArtNetReceiver } from "../src/ArtNetReceiver.js";
import { ArtNetSender } from "../src/ArtNetSender.js";

/**
 * Pick a random high port to avoid conflicts with real Art-Net traffic.
 */
function randomPort(): number {
    return 10000 + Math.floor(Math.random() * 50000);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Art-Net Roundtrip Integration", () => {
    let receiver: ArtNetReceiver;
    let sender: ArtNetSender;
    let port: number;

    beforeEach(async () => {
        port = randomPort();
        receiver = new ArtNetReceiver({ port, bindAddress: "127.0.0.1" });
        await receiver.start();
        sender = new ArtNetSender({ targetAddress: "127.0.0.1", port });
    });

    afterEach(async () => {
        sender.close();
        await receiver.stop();
    });

    it("should send DMX on universe 0 and receive it", async () => {
        const data = new Uint8Array(4);
        data[0] = 10;
        data[1] = 20;
        data[2] = 30;
        data[3] = 40;

        const received = new Promise<{ universe: number; data: Uint8Array }>((resolve) => {
            receiver.on("dmx", (universe, rxData) => {
                resolve({ universe, data: rxData });
            });
        });

        sender.sendDmx(0, data, 1);

        const result = await Promise.race([received, delay(2000).then(() => undefined)]);
        assert.ok(result, "Timed out waiting for DMX packet");
        assert.equal(result.universe, 0);
        assert.equal(result.data[0], 10);
        assert.equal(result.data[1], 20);
        assert.equal(result.data[2], 30);
        assert.equal(result.data[3], 40);
    });

    it("should send DMX on universe 5 and verify universe number", async () => {
        const data = new Uint8Array(2);
        data[0] = 0xff;
        data[1] = 0x80;

        const received = new Promise<number>((resolve) => {
            receiver.on("dmx", (universe) => {
                resolve(universe);
            });
        });

        sender.sendDmx(5, data);

        const universe = await Promise.race([received, delay(2000).then(() => undefined)]);
        assert.ok(universe !== undefined, "Timed out waiting for DMX packet");
        assert.equal(universe, 5);
    });

    it("should receive multiple frames sent quickly", async () => {
        const frames: number[] = [];
        const allReceived = new Promise<void>((resolve) => {
            receiver.on("dmx", (universe) => {
                frames.push(universe);
                if (frames.length >= 3) resolve();
            });
        });

        const data = new Uint8Array(2);
        sender.sendDmx(1, data, 1);
        sender.sendDmx(2, data, 2);
        sender.sendDmx(3, data, 3);

        await Promise.race([allReceived, delay(2000)]);
        assert.ok(frames.length >= 3, `Expected 3 frames, got ${frames.length}`);
        assert.ok(frames.includes(1));
        assert.ok(frames.includes(2));
        assert.ok(frames.includes(3));
    });

    it("should send poll packet and receive poll event", async () => {
        const received = new Promise<{ address: string; port: number }>((resolve) => {
            receiver.on("poll", (info) => {
                resolve(info);
            });
        });

        sender.sendPoll();

        const info = await Promise.race([received, delay(2000).then(() => undefined)]);
        assert.ok(info, "Timed out waiting for poll event");
        assert.equal(info.address, "127.0.0.1");
    });
});
