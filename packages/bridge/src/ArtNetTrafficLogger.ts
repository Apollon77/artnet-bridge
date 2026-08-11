import {
  type ArtNetPacket,
  type ArtNetReceiver,
  type SourceInfo,
  ARTNET_HEADER,
  OP_OUTPUT,
  OP_POLL,
  OP_POLL_REPLY,
  opcodeName,
} from "@artnet-bridge/artnet";

export interface ArtNetTrafficLoggerOptions {
  /** Universes the bridge is configured for — traffic on others is called out. */
  configuredUniverses: number[];
  /** Aggregate summary interval in ms (default: 2000, 0 = no summaries) */
  summaryIntervalMs?: number;
  /** Minimum ms between detail lines for the same universe / source (default: 1000) */
  detailThrottleMs?: number;
}

interface SourceStats {
  total: number;
  byOpcode: Map<number, number>;
  unparsedByOpcode: Map<number, number>;
  universes: Set<number>;
}

const PREFIX = "[ArtNet:debug]";

/** Opcode of a datagram whose Art-Net ID field is wrong, so it has none. */
const NO_HEADER = -1;

/** Opcode a rejected datagram claims, or {@link NO_HEADER}. */
function claimedOpcode(data: Buffer): number {
  if (data.length < 10) return NO_HEADER;
  if (!data.subarray(0, 8).equals(ARTNET_HEADER)) return NO_HEADER;
  return data.readUInt16LE(8);
}

/**
 * Logs every Art-Net datagram the receiver sees, including ones the parser
 * rejects. Detail lines are throttled per source/universe; volume traffic is
 * reported as periodic aggregates so a 44Hz DMX stream stays readable.
 */
export class ArtNetTrafficLogger {
  private readonly receiver: ArtNetReceiver;
  private readonly configuredUniverses: ReadonlySet<number>;
  private readonly summaryIntervalMs: number;
  private readonly detailThrottleMs: number;

  private readonly stats = new Map<string, SourceStats>();
  private readonly seenSourceOpcodes = new Set<string>();
  private readonly lastDetailLog = new Map<string, number>();
  private summaryTimer?: ReturnType<typeof setInterval>;
  private attached = false;

  constructor(receiver: ArtNetReceiver, options: ArtNetTrafficLoggerOptions) {
    this.receiver = receiver;
    this.configuredUniverses = new Set(options.configuredUniverses);
    this.summaryIntervalMs = options.summaryIntervalMs ?? 2000;
    this.detailThrottleMs = options.detailThrottleMs ?? 1000;
  }

  private readonly onPacket = (packet: ArtNetPacket, rinfo: SourceInfo): void => {
    this.count(
      rinfo,
      packet.opcode,
      false,
      packet.opcode === OP_OUTPUT ? packet.universe : undefined,
    );

    switch (packet.opcode) {
      case OP_OUTPUT: {
        const first = this.firstFrom(rinfo, packet.opcode);
        if (!this.allowDetail(`dmx:${rinfo.address}:${packet.universe}`) && !first) return;
        const preview = [...packet.data.subarray(0, 12)].join(" ");
        const mapped = this.configuredUniverses.has(packet.universe)
          ? ""
          : ` — universe NOT configured (configured: ${this.universeList()})`;
        console.log(
          `${PREFIX} OpDmx from ${format(rinfo)} universe ${packet.universe} seq ${packet.sequence} ` +
            `phys ${packet.physical} ${packet.data.length} channels [ch1-12: ${preview}]${mapped}`,
        );
        break;
      }
      case OP_POLL: {
        const first = this.firstFrom(rinfo, packet.opcode);
        if (!this.allowDetail(`poll:${rinfo.address}`) && !first) return;
        console.log(
          `${PREFIX} OpPoll from ${format(rinfo)} protocol version ${packet.protocolVersion} ` +
            `flags 0x${packet.flags.toString(16).padStart(2, "0")}${describePollFlags(packet.flags)}`,
        );
        break;
      }
      case OP_POLL_REPLY: {
        const first = this.firstFrom(rinfo, packet.opcode);
        if (!this.allowDetail(`reply:${rinfo.address}`) && !first) return;
        console.log(
          `${PREFIX} OpPollReply from ${format(rinfo)} "${packet.shortName}" (${packet.longName}) ` +
            `ports ${packet.numPorts} swOut ${packet.swOut.join(",")} net ${packet.netSwitch} ` +
            `sub ${packet.subSwitch} status1 0x${packet.status1.toString(16)} report "${packet.nodeReport}"`,
        );
        break;
      }
    }
  };

  private readonly onUnparsed = (data: Buffer, rinfo: SourceInfo, reason: string): void => {
    const opcode = claimedOpcode(data);
    this.count(rinfo, opcode, true, undefined);
    // Throttle per claimed opcode so a flood of one unhandled type cannot hide
    // the single malformed packet that matters
    const first = this.firstFrom(rinfo, opcode, "unparsed");
    if (!this.allowDetail(`unparsed:${rinfo.address}:${opcode}`) && !first) return;
    console.log(
      `${PREFIX} Dropped datagram from ${format(rinfo)} (${data.length} bytes): ${reason} ` +
        `head 0x${data.subarray(0, 24).toString("hex")}`,
    );
  };

  private readonly onPollReply = (
    target: SourceInfo,
    universes: number[],
    broadcast: boolean,
  ): void => {
    console.log(
      `${PREFIX} OpPollReply sent to ${format(target)}${broadcast ? " and broadcast" : " (broadcast failed)"} ` +
        `— advertising universes ${universes.length > 0 ? universes.join(", ") : "(none)"}`,
    );
  };

  /** Subscribe to receiver events and start periodic summaries. */
  attach(): void {
    if (this.attached) return;
    this.attached = true;

    this.receiver.on("packet", this.onPacket);
    this.receiver.on("unparsed", this.onUnparsed);
    this.receiver.on("pollReply", this.onPollReply);

    if (this.summaryIntervalMs > 0) {
      this.summaryTimer = setInterval(() => {
        this.logSummary();
      }, this.summaryIntervalMs);
    }

    console.log(`${PREFIX} Traffic logging enabled — configured universes: ${this.universeList()}`);
  }

  /** Unsubscribe and stop summaries. */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;

    this.receiver.off("packet", this.onPacket);
    this.receiver.off("unparsed", this.onUnparsed);
    this.receiver.off("pollReply", this.onPollReply);

    if (this.summaryTimer) {
      clearInterval(this.summaryTimer);
      this.summaryTimer = undefined;
    }
    this.stats.clear();
    this.seenSourceOpcodes.clear();
    this.lastDetailLog.clear();
  }

  private count(
    rinfo: SourceInfo,
    opcode: number,
    unparsed: boolean,
    universe: number | undefined,
  ): void {
    if (this.summaryIntervalMs === 0) return;

    let stats = this.stats.get(rinfo.address);
    if (!stats) {
      stats = {
        total: 0,
        byOpcode: new Map<number, number>(),
        unparsedByOpcode: new Map<number, number>(),
        universes: new Set<number>(),
      };
      this.stats.set(rinfo.address, stats);
    }
    stats.total++;
    const counter = unparsed ? stats.unparsedByOpcode : stats.byOpcode;
    counter.set(opcode, (counter.get(opcode) ?? 0) + 1);
    if (universe !== undefined) stats.universes.add(universe);
  }

  /** True the first time a given opcode is seen from a given source. */
  private firstFrom(rinfo: SourceInfo, opcode: number, kind = "packet"): boolean {
    const key = `${kind}:${rinfo.address}:${opcode}`;
    if (this.seenSourceOpcodes.has(key)) return false;
    this.seenSourceOpcodes.add(key);
    return true;
  }

  private allowDetail(key: string): boolean {
    const now = Date.now();
    const last = this.lastDetailLog.get(key) ?? 0;
    if (now - last < this.detailThrottleMs) return false;
    this.lastDetailLog.set(key, now);
    return true;
  }

  private universeList(): string {
    const universes = [...this.configuredUniverses].sort((a, b) => a - b);
    return universes.length > 0 ? universes.join(", ") : "(none)";
  }

  private logSummary(): void {
    if (this.stats.size === 0) {
      console.log(`${PREFIX} No Art-Net traffic received in the last ${this.summaryIntervalMs}ms`);
      return;
    }

    const seconds = this.summaryIntervalMs / 1000;
    for (const [address, stats] of this.stats) {
      const breakdown = new Array<string>();
      for (const [opcode, count] of stats.byOpcode) {
        breakdown.push(`${opcodeName(opcode)} ${count}`);
      }
      for (const [opcode, count] of stats.unparsedByOpcode) {
        const label = opcode === NO_HEADER ? "non-Art-Net" : opcodeName(opcode);
        breakdown.push(`${label} ${count} dropped`);
      }
      const universes =
        stats.universes.size > 0
          ? ` universes ${[...stats.universes].sort((a, b) => a - b).join(", ")}`
          : "";
      const rate = Math.round((stats.total / seconds) * 10) / 10;
      console.log(
        `${PREFIX} ${address}: ${stats.total} packets (${rate}/s) [${breakdown.join(", ")}]${universes}`,
      );
    }
    this.stats.clear();
  }
}

function format(rinfo: SourceInfo): string {
  return `${rinfo.address}:${rinfo.port}`;
}

function describePollFlags(flags: number): string {
  const set = new Array<string>();
  if (flags & 0x02) set.push("reply-on-change");
  if (flags & 0x04) set.push("diagnostics");
  if (flags & 0x08) set.push("diag-unicast");
  if (flags & 0x10) set.push("disable-VLC");
  if (flags & 0x20) set.push("targeted-mode");
  return set.length > 0 ? ` (${set.join(", ")})` : "";
}
