/**
 * Byte helpers for data that crosses the IPC boundary.
 *
 * Structured clone serializes a typed array together with its *whole* backing
 * ArrayBuffer, so views into pooled Node buffers (or encoder scratch buffers)
 * must be compacted before they are sent to the renderer.
 */

/**
 * Returns a plain `Uint8Array` that owns its entire backing buffer. Copies only
 * when `bytes` is a view into a larger buffer or a `Buffer` subclass instance.
 */
export function toOwnedBytes(bytes: Uint8Array): Uint8Array {
  const ownsBuffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
  if (ownsBuffer && Object.getPrototypeOf(bytes) === Uint8Array.prototype) return bytes
  if (ownsBuffer && bytes.buffer instanceof ArrayBuffer) return new Uint8Array(bytes.buffer)
  return new Uint8Array(bytes)
}
