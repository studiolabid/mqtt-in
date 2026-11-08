/**
 * The TLS files of a profile (CA, client certificate, client key), loaded before any mqtt.js
 * client exists:
 * - read asynchronously, one at a time, with a timeout and a size cap, so a file on an
 *   unreachable network share fails after a few seconds instead of freezing the main process;
 * - checked with `tls.createSecureContext` (plus a PEM check: Node silently ignores a CA file
 *   without certificates), so a wrong passphrase, a DER file or a key that does not match the
 *   certificate gives a human error instead of an exception inside mqtt.js.
 */
import { readFile, stat } from 'node:fs/promises'
import { createSecureContext, type SecureContextOptions } from 'node:tls'
import type { TlsSettings } from '@shared/models'
import { errorCode, errorMessage, isRecord } from '../../utils/errors'
import type { ReadFileFn, ReadFileOptions } from './types'

/** The file contents mqtt.js forwards to `tls.connect` / `ws`. */
export interface TlsMaterial {
  ca?: Buffer
  cert?: Buffer
  key?: Buffer
}

/** TLS files above this size are refused (a CA bundle is a few hundred KB at most). */
export const TLS_FILE_MAX_BYTES = 1024 * 1024
/** Time allowed for reading one TLS file. */
export const TLS_READ_TIMEOUT_MS = 5000

type Slot = keyof TlsMaterial

const LABELS: Readonly<Record<Slot, string>> = {
  ca: 'CA file',
  cert: 'client certificate file',
  key: 'client key file'
}

/** Error codes of a network path that cannot be reached (Windows reports `UNKNOWN`). */
const UNREACHABLE = new Set([
  'UNKNOWN',
  'ETIMEDOUT',
  'EHOSTDOWN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'ABORT_ERR'
])

const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----/g

export interface LoadTlsOptions {
  readFile?: ReadFileFn
  timeoutMs?: number
  maxBytes?: number
}

/** True when the profile names at least one TLS file. */
export function hasTlsFiles(tls: TlsSettings): boolean {
  return tlsFiles(tls).length > 0
}

/**
 * Reads and checks the TLS files of `tls`; resolves `{}` when it names none. Throws a human
 * error, e.g. `Cannot reach \\server\share\ca.pem (network share unavailable)` or
 * `Cannot decrypt the private key — check the passphrase`.
 */
export async function loadTlsMaterial(
  tls: TlsSettings,
  options: LoadTlsOptions = {}
): Promise<TlsMaterial> {
  const material: TlsMaterial = {}
  // One file at a time: the first unreachable one ends the attempt (no pile-up of blocked reads).
  for (const { slot, path } of tlsFiles(tls)) material[slot] = await readOne(slot, path, options)
  checkTlsMaterial(material, tls.passphrase)
  return material
}

/**
 * The default `ReadFileFn`: a regular file of at most `maxBytes` (an `EFBIG` error otherwise).
 * `stat` cannot be aborted: the caller's timeout covers it.
 */
export async function readTlsFile(path: string, options: ReadFileOptions): Promise<Buffer> {
  const info = await stat(path)
  if (info.isDirectory()) throw codeError('EISDIR', `${path} is a directory`)
  if (!info.isFile()) throw codeError('ENOTFILE', `${path} is not a regular file`)
  if (info.size > options.maxBytes) throw codeError('EFBIG', `${path} is too large`)
  return readFile(path, { signal: options.signal })
}

/** Checks TLS file contents the way `tls.connect` will use them. Throws a human error. */
export function checkTlsMaterial(material: TlsMaterial, passphrase: string): void {
  for (const slot of ['ca', 'cert', 'key'] as const) {
    const data = material[slot]
    if (data) checkPem(data, slot)
  }
  const secret = passphrase === '' ? undefined : passphrase
  // Each file alone first, so the error names the file; then the certificate with its key.
  if (material.ca) secureContext({ ca: material.ca }, 'ca', secret)
  if (material.cert) secureContext({ cert: material.cert }, 'cert', secret)
  if (material.key) secureContext({ key: material.key, passphrase: secret }, 'key', secret)
  if (material.cert && material.key) {
    secureContext({ cert: material.cert, key: material.key, passphrase: secret }, 'cert', secret)
  }
}

function tlsFiles(tls: TlsSettings): Array<{ slot: Slot; path: string }> {
  const paths: Record<Slot, string> = { ca: tls.caPath, cert: tls.certPath, key: tls.keyPath }
  return (['ca', 'cert', 'key'] as const)
    .map((slot) => ({ slot, path: paths[slot].trim() }))
    .filter((file) => file.path !== '')
}

async function readOne(slot: Slot, path: string, options: LoadTlsOptions): Promise<Buffer> {
  const read = options.readFile ?? readTlsFile
  const maxBytes = options.maxBytes ?? TLS_FILE_MAX_BYTES
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const err = codeError('ETIMEDOUT', `Reading ${path} timed out`)
      controller.abort(err)
      reject(err)
    }, options.timeoutMs ?? TLS_READ_TIMEOUT_MS)
  })
  try {
    const data = await Promise.race([read(path, { signal: controller.signal, maxBytes }), timeout])
    if (data.byteLength > maxBytes) throw codeError('EFBIG', `${path} is too large`)
    return data
  } catch (err) {
    throw new Error(readFailure(slot, path, err, maxBytes), { cause: err })
  } finally {
    clearTimeout(timer)
  }
}

function readFailure(slot: Slot, path: string, err: unknown, maxBytes: number): string {
  const label = LABELS[slot]
  const code = errorCode(err)
  const aborted = isRecord(err) && err.name === 'AbortError'
  if (aborted || (code !== undefined && UNREACHABLE.has(code))) {
    return `Cannot reach ${path} (network share unavailable)`
  }
  const reason = (text: string): string => `Cannot read ${label} ${path}: ${text}`
  switch (code) {
    case 'ENOENT':
    case 'ENOTDIR':
      return reason('file not found')
    case 'EACCES':
    case 'EPERM':
      return reason('permission denied')
    case 'EISDIR':
      return reason('it is a directory')
    case 'ENOTFILE':
      return reason('it is not a regular file')
    case 'EFBIG':
      return `${capitalize(label)} is larger than ${Math.round(maxBytes / (1024 * 1024))} MB`
    default:
      return reason(errorMessage(err))
  }
}

/** Node accepts a CA "bundle" without any certificate (and then trusts nothing): refuse it. */
function checkPem(data: Buffer, slot: Slot): void {
  const label = LABELS[slot]
  const blocks = [...data.toString('latin1').matchAll(PEM_BLOCK)].map((match) => match[1])
  if (blocks.length === 0) throw new Error(`Invalid ${label} (PEM expected)`)
  const wanted = slot === 'key' ? /PRIVATE KEY$/ : /CERTIFICATE$/
  if (!blocks.some((block) => wanted.test(block))) {
    const missing = slot === 'key' ? 'no private key' : 'no certificate'
    throw new Error(`The ${label} contains ${missing}`)
  }
}

function secureContext(options: SecureContextOptions, slot: Slot, passphrase?: string): void {
  try {
    createSecureContext(options)
  } catch (err) {
    throw new Error(materialFailure(err, slot, passphrase), { cause: err })
  }
}

/** OpenSSL (Node) and BoringSSL (Electron) word the same failures differently. */
function materialFailure(err: unknown, slot: Slot, passphrase?: string): string {
  const text = `${errorCode(err) ?? ''} ${errorMessage(err)}`
  if (/bad[ _]?decrypt|bad password|decrypt/i.test(text)) {
    return passphrase === undefined
      ? 'The client key is encrypted — enter its passphrase'
      : 'Cannot decrypt the private key — check the passphrase'
  }
  if (/key[ _]?values[ _]?mismatch/i.test(text)) {
    return 'The client certificate does not match the private key'
  }
  const label = LABELS[slot]
  if (/no[ _]?start[ _]?line/i.test(text)) return `Invalid ${label} (PEM expected)`
  return `Invalid ${label}: ${opensslReason(err)}`
}

/** `error:1E08010C:DECODER routines::unsupported` → `unsupported`. */
function opensslReason(err: unknown): string {
  const reason = isRecord(err) && typeof err.reason === 'string' ? err.reason : undefined
  const last = (reason ?? errorMessage(err)).split(':').pop() ?? ''
  return last.replace(/_/g, ' ').trim().toLowerCase() || 'unreadable'
}

function codeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
