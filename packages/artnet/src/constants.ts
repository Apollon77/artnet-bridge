/**
 * Art-Net protocol constants derived from the Art-Net 4 specification.
 */

/** Art-Net packet header: "Art-Net\0" (8 bytes) */
export const ARTNET_HEADER = Buffer.from([0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00]);

/** Art-Net UDP port: 0x1936 (6454) */
export const ARTNET_PORT = 6454;

/** OpCode for ArtDmx / OpOutput: 0x5000 */
export const OP_OUTPUT = 0x5000;

/** OpCode for ArtPoll: 0x2000 */
export const OP_POLL = 0x2000;

/** OpCode for ArtPollReply: 0x2100 */
export const OP_POLL_REPLY = 0x2100;

/** Art-Net protocol version (current: 14) */
export const PROTOCOL_VERSION = 14;

/** Minimum DMX data length in an ArtDmx packet */
export const MIN_DMX_LENGTH = 2;

/** Maximum DMX data length in an ArtDmx packet (512 channels) */
export const MAX_DMX_LENGTH = 512;

/** Maximum 15-bit Port-Address value */
export const MAX_PORT_ADDRESS = 0x7fff;
