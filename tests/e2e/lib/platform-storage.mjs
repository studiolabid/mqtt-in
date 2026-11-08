/**
 * platform-storage helpers: seeded profiles with damaged files, and (Windows) another process that
 * holds a profile file open with FileShare.None while mqtt-in starts (SEC-01).
 */
import { spawn } from 'node:child_process'
import { connectionProfile, waitFor } from './platform.mjs'

/** Two saved connections (never connected to) and their connections.json text. */
export const SAVED = [1, 2].map((n) =>
  connectionProfile({
    id: `seed-${n}`,
    name: `Production broker ${n}`,
    host: `broker${n}.example.com`,
    port: 8883,
    protocol: 'mqtts',
    username: `user${n}`
  })
)
export const SAVED_TEXT = JSON.stringify({ version: 1, connections: SAVED }, null, 2)

/** The first 60 % of a file: what a crash in the middle of a write leaves behind. */
export const truncated = (text) => text.slice(0, Math.floor(text.length * 0.6))

/** The damaged copy main moves aside: data/connections.corrupt-<time>.json. */
export const CORRUPT_COPY = /[\\/]connections\.corrupt-[^\\/]+\.json$/

/**
 * Windows: another process (PowerShell, started here, so its PID is ours) opens `path` with
 * FileShare.None and keeps it open until `release()`, or until this process exits (its stdin
 * closes). Resolves once the file is held: `{ pid, release }`.
 */
export async function holdFileLock(path) {
  if (process.platform !== 'win32') throw new Error('holdFileLock is Windows only')
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$f = [System.IO.File]::Open('${path.replace(/'/g, "''")}', 'Open', 'ReadWrite', 'None')`,
    "[Console]::Out.WriteLine('locked')",
    '[Console]::Out.Flush()',
    '[void][Console]::In.ReadLine()',
    '$f.Close()',
    "[Console]::Out.WriteLine('released')"
  ].join('\n')
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
  )
  let out = ''
  let err = ''
  child.stdout.on('data', (data) => (out += data))
  child.stderr.on('data', (data) => (err += data))
  const exited = new Promise((done) => child.once('exit', done))
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.stdin.end('\n')
    const gone = await Promise.race([exited.then(() => true), sleepMs(5_000).then(() => false)])
    if (!gone) child.kill() // our own PID: TerminateProcess releases the handle
  }
  try {
    await waitFor(() => out.includes('locked') || child.exitCode !== null, {
      timeout: 30_000,
      label: 'PowerShell to open the file'
    })
    if (!out.includes('locked')) throw new Error(`the file could not be locked: ${err.trim()}`)
  } catch (error) {
    await stop()
    throw error
  }
  return {
    pid: child.pid,
    async release() {
      await stop()
      return out.includes('released')
    }
  }
}

const sleepMs = (ms) => new Promise((done) => setTimeout(done, ms))

/** `{ ok: true, value }` or `{ ok: false, error }` (the rejection message): never throws. */
export const outcome = (promise) =>
  Promise.resolve(promise).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error: String(error?.message ?? error) })
  )
