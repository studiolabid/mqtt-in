import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMainLog, logUncaughtErrors, type ProcessEvents } from '../../../src/main/main-log'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mqtt-in-main-log-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('createMainLog', () => {
  it('appends timestamped entries, with the stack of an error', () => {
    const log = createMainLog(join(dir, 'logs'), { now: () => 0 })
    log.append('uncaughtException', new TypeError('boom'))
    log.append('render-process-gone', { reason: 'crashed', exitCode: 3 })
    const text = readFileSync(log.path, 'utf8')
    expect(log.path).toBe(join(dir, 'logs', 'main.log'))
    expect(text).toMatch(
      /^1970-01-01T00:00:00\.000Z \[uncaughtException\] TypeError: boom\n {4}at /
    )
    expect(text).toContain(
      '1970-01-01T00:00:00.000Z [render-process-gone] {"reason":"crashed","exitCode":3}\n'
    )
  })

  it('stays under its size: the full log moves to main.old.log', () => {
    const log = createMainLog(dir, { maxBytes: 200 })
    for (let i = 0; i < 6; i++) log.append('entry', `${i} ${'x'.repeat(40)}`)
    expect(readFileSync(log.path, 'utf8').length).toBeLessThanOrEqual(200)
    expect(readFileSync(log.path, 'utf8')).toContain('[entry] 5 ')
    expect(readFileSync(join(dir, 'main.old.log'), 'utf8')).toContain('[entry] ')
  })

  it('never throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // A folder name no file system accepts.
    const log = createMainLog(join(dir, 'missing', '\u0000'))
    expect(() => log.append('entry', 'x')).not.toThrow()
    expect(error).toHaveBeenCalled()
  })
})

describe('logUncaughtErrors', () => {
  it('logs uncaught exceptions and rejections instead of crashing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const target = new EventEmitter()
    const log = createMainLog(dir, { now: () => 0 })
    logUncaughtErrors(log, target as unknown as ProcessEvents)
    target.emit('uncaughtException', new Error('thrown in a timer'))
    target.emit('unhandledRejection', new Error('nobody awaited me'), Promise.resolve())
    const text = readFileSync(log.path, 'utf8')
    expect(text).toContain('[uncaughtException] Error: thrown in a timer')
    expect(text).toContain('[unhandledRejection] Error: nobody awaited me')
    expect(existsSync(join(dir, 'main.old.log'))).toBe(false)
  })
})
