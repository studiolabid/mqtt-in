/**
 * Process helpers. They only ever stop processes this run started: a child process handle we
 * own (never a process name), or an Electron process whose command line names one of the
 * temporary profiles this run created (Chromium passes `--user-data-dir=<profile>` to every
 * child process). Other agents' Electron and the user's own mqtey are never touched.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { basename } from 'node:path'

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** `promise`'s value, or `fallback` after `ms` or on a rejection (never hangs, never throws). */
export function within(promise, ms, fallback) {
  let timer
  const late = new Promise((done) => {
    timer = setTimeout(() => done(fallback), ms)
  })
  return Promise.race([Promise.resolve(promise).catch(() => fallback), late]).finally(() =>
    clearTimeout(timer)
  )
}

/** True while `child` (a ChildProcess this run started) has not exited. */
export function isRunning(child) {
  return Boolean(child?.pid) && child.exitCode === null && child.signalCode === null
}

/**
 * Kills the process tree of `child`, a process this run started. A no-op once it has exited:
 * its PID may already belong to someone else.
 */
export function killTree(child) {
  if (!isRunning(child)) return false
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    })
  } else {
    try {
      child.kill('SIGKILL')
    } catch {
      // already gone
    }
  }
  return true
}

/** Resolves true when `child` exits within `ms`, false otherwise. */
export function waitForExit(child, ms) {
  if (!isRunning(child)) return Promise.resolve(true)
  return new Promise((done) => {
    const timer = setTimeout(() => done(false), ms)
    child.once('exit', () => {
      clearTimeout(timer)
      done(true)
    })
  })
}

/** Every running Electron process: { pid, ppid, command }. */
function electronProcesses() {
  if (process.platform === 'win32') {
    const script =
      'Get-CimInstance Win32_Process -Filter "Name=\'electron.exe\'" | ' +
      'Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress'
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30_000
      }
    ).trim()
    if (!out) return []
    const rows = [JSON.parse(out)].flat()
    return rows.map((row) => ({
      pid: row.ProcessId,
      ppid: row.ParentProcessId,
      command: String(row.CommandLine ?? '')
    }))
  }
  const out = execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' })
  return out
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter((match) => match && /electron/i.test(match[3]))
    .map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }))
}

/**
 * Electron processes of this run that are still alive: a main process this run started (its PID
 * and its main script still match) or any process whose command line names one of `profiles`.
 *
 * @param {{ mains: { pid: number, script: string }[], profiles: string[] }} started
 */
export function findLeftovers({ mains, profiles }) {
  const names = profiles.map((dir) => basename(dir).toLowerCase())
  const scripts = new Map(mains.map((main) => [main.pid, main.script.toLowerCase()]))
  return electronProcesses().filter(({ pid, command }) => {
    const line = command.toLowerCase()
    if (scripts.has(pid) && line.includes(scripts.get(pid))) return true
    return names.some((name) => line.includes(name))
  })
}

/** Kills one leftover process found by `findLeftovers` (by PID: it is ours). */
export function killLeftover({ pid }) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore', windowsHide: true })
  } else {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
}
