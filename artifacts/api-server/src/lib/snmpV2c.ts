import dgram from "node:dgram";
import { isIP } from "node:net";

export type SnmpVarbind = {
  oid: string;
  value: string | number | null;
};

const SNMP_V2C = 1;
const GET_BULK = 0xa5;
const RESPONSE = 0xa2;
const NULL = Buffer.from([0x05, 0x00]);

function encodeLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  for (let current = length; current > 0; current >>= 8) bytes.unshift(current & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, contents: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), encodeLength(contents.length), contents]);
}

function integer(value: number): Buffer {
  const bytes: number[] = [];
  let current = value >>> 0;
  do {
    bytes.unshift(current & 0xff);
    current >>>= 8;
  } while (current > 0);
  if (bytes[0]! & 0x80) bytes.unshift(0);
  return tlv(0x02, Buffer.from(bytes));
}

function oid(value: string): Buffer {
  const parts = value.split(".").map((part) => Number(part));
  if (parts.length < 2 || parts.some((part) => !Number.isInteger(part) || part < 0)) throw new Error(`Invalid SNMP OID: ${value}`);
  const bytes = [parts[0]! * 40 + parts[1]!];
  for (const part of parts.slice(2)) {
    const encoded: number[] = [part & 0x7f];
    for (let current = part >>> 7; current > 0; current >>>= 7) encoded.unshift(0x80 | (current & 0x7f));
    bytes.push(...encoded);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function sequence(...items: Buffer[]): Buffer {
  return tlv(0x30, Buffer.concat(items));
}

function decodeOid(value: Buffer): string {
  const parts = [Math.floor(value[0]! / 40), value[0]! % 40];
  let current = 0;
  for (const byte of value.subarray(1)) {
    current = (current << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      parts.push(current);
      current = 0;
    }
  }
  return parts.join(".");
}

function decodeInteger(value: Buffer): number {
  let result = 0;
  for (const byte of value) result = (result << 8) | byte;
  return result;
}

type ParsedTlv = { tag: number; value: Buffer; next: number };
function readTlv(source: Buffer, offset: number): ParsedTlv {
  if (offset + 2 > source.length) throw new Error("Malformed SNMP response");
  const tag = source[offset]!;
  let cursor = offset + 1;
  const firstLength = source[cursor++]!;
  let length = firstLength;
  if (firstLength & 0x80) {
    const bytes = firstLength & 0x7f;
    if (bytes === 0 || cursor + bytes > source.length) throw new Error("Malformed SNMP response length");
    length = 0;
    for (let index = 0; index < bytes; index += 1) length = (length << 8) | source[cursor++]!;
  }
  if (cursor + length > source.length) throw new Error("Truncated SNMP response");
  return { tag, value: source.subarray(cursor, cursor + length), next: cursor + length };
}

function children(value: Buffer): ParsedTlv[] {
  const output: ParsedTlv[] = [];
  for (let offset = 0; offset < value.length;) {
    const parsed = readTlv(value, offset);
    output.push(parsed);
    offset = parsed.next;
  }
  return output;
}

function parseValue(field: ParsedTlv): string | number | null {
  if (field.tag === 0x02 || field.tag === 0x43 || field.tag === 0x42) return decodeInteger(field.value);
  if (field.tag === 0x04) {
    const text = field.value.toString("utf8").replace(/\0+$/g, "").trim();
    return text || field.value.toString("hex").toUpperCase();
  }
  if (field.tag === 0x06) return decodeOid(field.value);
  if (field.tag === 0x05 || field.tag === 0x80 || field.tag === 0x81 || field.tag === 0x82) return null;
  return field.value.toString("hex").toUpperCase();
}

function parseResponse(packet: Buffer, requestId: number): SnmpVarbind[] {
  const message = readTlv(packet, 0);
  if (message.tag !== 0x30 || message.next !== packet.length) throw new Error("Invalid SNMP response envelope");
  const [version, _community, pdu] = children(message.value);
  if (!version || !pdu || decodeInteger(version.value) !== SNMP_V2C || pdu.tag !== RESPONSE) throw new Error("Unexpected SNMP response");
  const [responseId, errorStatus, _errorIndex, varbindList] = children(pdu.value);
  if (!responseId || !errorStatus || !varbindList || decodeInteger(responseId.value) !== requestId) throw new Error("Mismatched SNMP response");
  if (decodeInteger(errorStatus.value) !== 0) throw new Error(`SNMP agent returned error status ${decodeInteger(errorStatus.value)}`);
  return children(varbindList.value).flatMap((varbind) => {
    const [name, value] = children(varbind.value);
    if (!name || !value || name.tag !== 0x06) return [];
    return [{ oid: decodeOid(name.value), value: parseValue(value) }];
  });
}

function bulkPacket(requestId: number, community: string, startOid: string, maxRepetitions: number): Buffer {
  const varbinds = sequence(sequence(oid(startOid), NULL));
  const pdu = tlv(GET_BULK, Buffer.concat([integer(requestId), integer(0), integer(maxRepetitions), varbinds]));
  return sequence(integer(SNMP_V2C), tlv(0x04, Buffer.from(community, "utf8")), pdu);
}

async function request(host: string, port: number, packet: Buffer, requestId: number, timeoutMs: number): Promise<SnmpVarbind[]> {
  const family = isIP(host);
  if (!family) throw new Error("SNMP requires a resolved IP address");
  const socket = dgram.createSocket(family === 6 ? "udp6" : "udp4");
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("SNMP request timed out")), timeoutMs);
    const finish = (error?: Error, result?: SnmpVarbind[]) => {
      clearTimeout(timeout);
      socket.close();
      if (error) reject(error);
      else resolve(result ?? []);
    };
    socket.once("error", (error) => finish(error));
    socket.once("message", (message) => {
      try {
        finish(undefined, parseResponse(message, requestId));
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Unable to parse SNMP response"));
      }
    });
    socket.connect(port, host, () => {
      socket.send(packet, (sendError) => {
        if (sendError) finish(sendError);
      });
    });
  });
}

function isInTree(oidValue: string, root: string): boolean {
  return oidValue === root || oidValue.startsWith(`${root}.`);
}

export const snmpV2c = {
  async walk(host: string, port: number, community: string, root: string): Promise<SnmpVarbind[]> {
    const output: SnmpVarbind[] = [];
    let cursor = root;
    for (let batch = 0; batch < 100; batch += 1) {
      const requestId = Math.floor(Math.random() * 0x7fffffff);
      const response = await request(host, port, bulkPacket(requestId, community, cursor, 30), requestId, 2_000);
      const inTree = response.filter((varbind) => varbind.value !== null && isInTree(varbind.oid, root));
      if (!inTree.length) break;
      output.push(...inTree);
      const nextCursor = inTree.at(-1)!.oid;
      if (nextCursor === cursor || response.length < 30) break;
      cursor = nextCursor;
    }
    return output;
  },
};