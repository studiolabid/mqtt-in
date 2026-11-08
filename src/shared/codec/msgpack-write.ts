/**
 * MessagePack encoding of authored JSON values (null, booleans, numbers, bigints, strings,
 * arrays, plain objects) with exact numbers: integers in the smallest integer format, bigints as
 * 64-bit integers, every other number as float 64 — -0 included. The bytes are those
 * @msgpack/msgpack writes for the same values, which cannot do both: with `useBigInt64` it
 * writes safe integers beyond 32 bits as floats, without it bigints fail, and it always writes
 * -0 as the integer 0.
 */

/** Same limit as @msgpack/msgpack: 100 levels, the root value being the first. */
const MAX_DEPTH = 100
const UINT64_MAX = (1n << 64n) - 1n
const INT64_MIN = -(1n << 63n)

const textEncoder = new TextEncoder()

class ByteWriter {
  private bytes = new Uint8Array(256)
  private view = new DataView(this.bytes.buffer)
  private length = 0

  /** The written bytes (a copy that owns exactly its buffer). */
  result(): Uint8Array {
    return this.bytes.slice(0, this.length)
  }

  u8(value: number): void {
    this.reserve(1)
    this.view.setUint8(this.length++, value)
  }

  /** A type byte followed by a big-endian value of `size` bytes. */
  header(type: number, size: 1 | 2 | 4, value: number): void {
    this.u8(type)
    this.reserve(size)
    if (size === 1) this.view.setUint8(this.length, value)
    else if (size === 2) this.view.setUint16(this.length, value)
    else this.view.setUint32(this.length, value)
    this.length += size
  }

  int(type: number, size: 1 | 2 | 4, value: number): void {
    this.u8(type)
    this.reserve(size)
    if (size === 1) this.view.setInt8(this.length, value)
    else if (size === 2) this.view.setInt16(this.length, value)
    else this.view.setInt32(this.length, value)
    this.length += size
  }

  big(type: 0xcf | 0xd3, value: bigint): void {
    this.u8(type)
    this.reserve(8)
    if (type === 0xcf) this.view.setBigUint64(this.length, value)
    else this.view.setBigInt64(this.length, value)
    this.length += 8
  }

  float64(value: number): void {
    this.u8(0xcb)
    this.reserve(8)
    this.view.setFloat64(this.length, value)
    this.length += 8
  }

  raw(data: Uint8Array): void {
    this.reserve(data.length)
    this.bytes.set(data, this.length)
    this.length += data.length
  }

  private reserve(size: number): void {
    if (this.length + size <= this.bytes.length) return
    const grown = new Uint8Array(Math.max(this.bytes.length * 2, this.length + size))
    grown.set(this.bytes.subarray(0, this.length))
    this.bytes = grown
    this.view = new DataView(grown.buffer)
  }
}

/** MessagePack bytes of a JSON value (as `parseExactJson` returns it). */
export function encodeMsgpackJson(value: unknown): Uint8Array {
  const out = new ByteWriter()
  write(out, value, 1)
  return out.result()
}

function write(out: ByteWriter, value: unknown, depth: number): void {
  if (depth > MAX_DEPTH) throw new Error(`Too deeply nested (more than ${MAX_DEPTH} levels)`)
  if (value === null || value === undefined) out.u8(0xc0)
  else if (typeof value === 'boolean') out.u8(value ? 0xc3 : 0xc2)
  else if (typeof value === 'number') writeNumber(out, value)
  else if (typeof value === 'bigint') writeBigInt(out, value)
  else if (typeof value === 'string') writeString(out, value)
  else if (Array.isArray(value)) {
    writeLength(out, value.length, 0x90, 16, 0xdc, 0xdd)
    for (const item of value) write(out, item, depth + 1)
  } else if (typeof value === 'object') {
    const keys = Object.keys(value)
    writeLength(out, keys.length, 0x80, 16, 0xde, 0xdf)
    for (const key of keys) {
      writeString(out, key)
      write(out, (value as Record<string, unknown>)[key], depth + 1)
    }
  } else {
    throw new Error(`Cannot encode a ${typeof value} as MessagePack`)
  }
}

function writeNumber(out: ByteWriter, n: number): void {
  if (!Number.isSafeInteger(n) || Object.is(n, -0)) out.float64(n)
  else if (n >= 0) writeUnsigned(out, n)
  else if (n >= -0x20)
    out.u8(n & 0xff) // negative fixint
  else if (n >= -0x80) out.int(0xd0, 1, n)
  else if (n >= -0x8000) out.int(0xd1, 2, n)
  else if (n >= -0x80000000) out.int(0xd2, 4, n)
  else out.big(0xd3, BigInt(n))
}

function writeUnsigned(out: ByteWriter, n: number): void {
  if (n < 0x80)
    out.u8(n) // positive fixint
  else if (n < 0x100) out.header(0xcc, 1, n)
  else if (n < 0x10000) out.header(0xcd, 2, n)
  else if (n < 0x100000000) out.header(0xce, 4, n)
  else out.big(0xcf, BigInt(n))
}

function writeBigInt(out: ByteWriter, n: bigint): void {
  if (n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER)) {
    writeNumber(out, Number(n))
  } else if (n > UINT64_MAX || n < INT64_MIN) {
    throw new Error(`Integer ${n} cannot be represented exactly in MessagePack (64 bits at most)`)
  } else {
    out.big(n >= 0n ? 0xcf : 0xd3, n)
  }
}

function writeString(out: ByteWriter, text: string): void {
  const bytes = textEncoder.encode(text)
  if (bytes.length < 32) out.u8(0xa0 | bytes.length)
  else if (bytes.length < 0x100) out.header(0xd9, 1, bytes.length)
  else if (bytes.length < 0x10000) out.header(0xda, 2, bytes.length)
  else out.header(0xdb, 4, bytes.length)
  out.raw(bytes)
}

/** fix / 16-bit / 32-bit length header of an array or a map. */
function writeLength(
  out: ByteWriter,
  length: number,
  fix: number,
  fixLimit: number,
  type16: number,
  type32: number
): void {
  if (length < fixLimit) out.u8(fix | length)
  else if (length < 0x10000) out.header(type16, 2, length)
  else out.header(type32, 4, length)
}
