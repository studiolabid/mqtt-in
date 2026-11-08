/**
 * `watchLoadFailures` on fake web contents: a failed main-frame load is logged and, outside
 * automated runs, reported in an error box before the app exits; aborted loads and subframes are
 * not failures. Electron's dialog and app are mocked (no box ever opens).
 */
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ERR_ABORTED, watchLoadFailures } from '../../../src/main/window-load'

const electron = vi.hoisted(() => ({ showErrorBox: vi.fn(), exit: vi.fn() }))

vi.mock('electron', () => ({
  app: { exit: electron.exit },
  dialog: { showErrorBox: electron.showErrorBox }
}))

const URL = 'app://mqtt-in/index.html'

function watch(options: { background: boolean; quit?: () => void }): {
  contents: EventEmitter
  log: ReturnType<typeof vi.fn>
} {
  const contents = new EventEmitter()
  const log = vi.fn()
  watchLoadFailures(contents as unknown as WebContents, { ...options, log })
  return { contents, log }
}

function fail(contents: EventEmitter, code: number, mainFrame = true, url = URL): void {
  contents.emit(
    'did-fail-load',
    {},
    code,
    code === -6 ? 'ERR_FILE_NOT_FOUND' : 'ERR_FAILED',
    url,
    mainFrame
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('watchLoadFailures', () => {
  it('tells the user and exits with code 1 when the UI does not load', () => {
    const { contents, log } = watch({ background: false })
    fail(contents, -6)
    expect(log).toHaveBeenCalledWith('did-fail-load', {
      errorCode: -6,
      errorDescription: 'ERR_FILE_NOT_FOUND',
      url: URL
    })
    expect(electron.showErrorBox).toHaveBeenCalledTimes(1)
    expect(electron.showErrorBox.mock.calls[0][0]).toBe('mqtt-in could not start')
    expect(electron.showErrorBox.mock.calls[0][1]).toContain('ERR_FILE_NOT_FOUND')
    expect(electron.exit).toHaveBeenCalledWith(1)
  })

  it('uses the given quit function instead of app.exit', () => {
    const quit = vi.fn()
    const { contents } = watch({ background: false, quit })
    fail(contents, -2)
    expect(electron.showErrorBox).toHaveBeenCalledTimes(1)
    expect(quit).toHaveBeenCalledTimes(1)
    expect(electron.exit).not.toHaveBeenCalled()
  })

  it('only logs in automated runs: no box, no exit', () => {
    const { contents, log } = watch({ background: true })
    fail(contents, -2)
    expect(log).toHaveBeenCalledTimes(1)
    expect(electron.showErrorBox).not.toHaveBeenCalled()
    expect(electron.exit).not.toHaveBeenCalled()
  })

  it('ignores aborted loads (a newer navigation or a closing window)', () => {
    const { contents, log } = watch({ background: false })
    fail(contents, ERR_ABORTED)
    expect(log).not.toHaveBeenCalled()
    expect(electron.showErrorBox).not.toHaveBeenCalled()
    expect(electron.exit).not.toHaveBeenCalled()
  })

  it('ignores subframes', () => {
    const { contents, log } = watch({ background: false })
    fail(contents, -27, false, 'app://mqtt-in/frame.html')
    expect(log).not.toHaveBeenCalled()
    expect(electron.showErrorBox).not.toHaveBeenCalled()
  })
})
