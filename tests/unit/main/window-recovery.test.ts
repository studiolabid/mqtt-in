/**
 * `watchRendererHealth` on a fake window: crash reloads within the limit, the Reload / Quit and
 * Wait / Reload questions, and none of them in automated runs. Electron's dialog is mocked.
 */
import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { watchRendererHealth } from '../../../src/main/window-recovery'

const electron = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
  quit: vi.fn()
}))

vi.mock('electron', () => ({
  app: { quit: electron.quit },
  dialog: { showMessageBox: electron.showMessageBox }
}))

interface FakeWindow extends EventEmitter {
  webContents: EventEmitter & { forcefullyCrashRenderer: ReturnType<typeof vi.fn> }
  isDestroyed: () => boolean
}

function fakeWindow(): FakeWindow {
  const contents = Object.assign(new EventEmitter(), { forcefullyCrashRenderer: vi.fn() })
  return Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false })
}

function watch(background: boolean): { win: FakeWindow; reload: ReturnType<typeof vi.fn> } {
  const win = fakeWindow()
  const reload = vi.fn()
  watchRendererHealth(win as unknown as BrowserWindow, { background, reload, log: vi.fn() })
  return { win, reload }
}

function crash(win: FakeWindow, reason = 'crashed'): void {
  win.webContents.emit('render-process-gone', {}, { reason, exitCode: 1 })
}

/** Lets the dialog promise chains run. */
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0))

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('watchRendererHealth', () => {
  it('reloads a crashed renderer 3 times a minute, then asks Reload or Quit', async () => {
    const { win, reload } = watch(false)
    for (let i = 0; i < 3; i++) crash(win)
    // Back to the route it showed first; to the start page when it crashes again.
    expect(reload.mock.calls).toEqual([['current'], ['start'], ['start']])
    expect(electron.showMessageBox).not.toHaveBeenCalled()

    electron.showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false })
    crash(win, 'oom')
    await settle()
    expect(electron.showMessageBox).toHaveBeenCalledTimes(1)
    expect(electron.showMessageBox.mock.calls[0][1]).toMatchObject({
      message: "mqtey's window stopped working",
      buttons: ['Reload', 'Quit']
    })
    expect(reload).toHaveBeenCalledTimes(4)
    expect(reload).toHaveBeenLastCalledWith('start')

    electron.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    crash(win)
    await settle()
    expect(electron.quit).toHaveBeenCalledTimes(1)
  })

  it('never asks in an automated run', async () => {
    const { win, reload } = watch(true)
    for (let i = 0; i < 5; i++) crash(win)
    win.emit('unresponsive')
    await settle()
    expect(reload).toHaveBeenCalledTimes(3)
    expect(electron.showMessageBox).not.toHaveBeenCalled()
  })

  it('leaves a renderer alone that ended normally', () => {
    const { win, reload } = watch(false)
    crash(win, 'clean-exit')
    expect(reload).not.toHaveBeenCalled()
  })

  it('asks Wait or Reload while the window hangs; Reload restarts the renderer', async () => {
    const { win } = watch(false)
    electron.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    win.emit('unresponsive')
    win.emit('unresponsive')
    await settle()
    expect(electron.showMessageBox).toHaveBeenCalledTimes(1)
    expect(electron.showMessageBox.mock.calls[0][1]).toMatchObject({
      message: 'mqtey is not responding',
      buttons: ['Wait', 'Reload']
    })
    expect(win.webContents.forcefullyCrashRenderer).toHaveBeenCalledTimes(1)
  })

  it('closes the question when the window responds again', async () => {
    const { win } = watch(false)
    let signal: AbortSignal | undefined
    electron.showMessageBox.mockImplementationOnce(
      (_win: unknown, options: { signal: AbortSignal }) => {
        signal = options.signal
        return new Promise((resolve) => {
          options.signal.addEventListener('abort', () =>
            resolve({ response: 0, checkboxChecked: false })
          )
        })
      }
    )
    win.emit('unresponsive')
    win.emit('responsive')
    await settle()
    expect(signal?.aborted).toBe(true)
    expect(win.webContents.forcefullyCrashRenderer).not.toHaveBeenCalled()
  })
})
