/**
 * `registerIpc` against a mocked `ipcMain`: every channel of the contract (`IPC`) has exactly one
 * handler, nothing else is registered, and every handler refuses untrusted senders (other
 * origins, file://, subframes) before it runs. Uses the real storage in a temp folder.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebFrameMain } from 'electron'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/ipc'
import { registerIpc } from '../../../src/main/ipc'
import type { MqttManager } from '../../../src/main/services/mqtt/mqtt-manager'
import { createStorage, type Storage } from '../../../src/main/services/storage'
import { PLAIN_CIPHER } from '../../../src/main/services/storage/secrets'

type Listener = (event: unknown, ...args: unknown[]) => Promise<unknown>

const electron = vi.hoisted(() => ({
  handlers: new Map<string, Listener>(),
  registrations: [] as string[]
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: Listener) => {
      electron.registrations.push(channel)
      electron.handlers.set(channel, listener)
    },
    removeHandler: (channel: string) => electron.handlers.delete(channel)
  },
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] },
  nativeTheme: { on: () => undefined, themeSource: 'system', shouldUseDarkColors: false },
  app: { getPath: () => tmpdir(), isPackaged: false },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false }
}))

let dir: string
let storage: Storage

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mqtt-in-ipc-registration-'))
  storage = createStorage(dir, PLAIN_CIPHER)
  registerIpc({ storage, manager: {} as MqttManager })
})

afterAll(() => {
  storage.flush()
  rmSync(dir, { recursive: true, force: true })
})

function frame(url: string, routingId = 1): WebFrameMain {
  return { url, routingId, processId: 3 } as unknown as WebFrameMain
}

/** An invoke event from `sender` in a window whose main frame is `main`. */
function from(sender: WebFrameMain | null, main: WebFrameMain | null = sender): unknown {
  return { senderFrame: sender, sender: { mainFrame: main } }
}

describe('registerIpc', () => {
  it('registers exactly one handler per IPC channel of the contract', () => {
    const channels = Object.values(IPC)
    expect([...electron.handlers.keys()].sort()).toEqual([...channels].sort())
    expect(electron.registrations).toHaveLength(channels.length)
  })

  it.each([
    ['another origin', from(frame('https://example.com/'))],
    ['a file:// page', from(frame('file:///C:/Users/me/evil.html'))],
    [
      'a subframe of the app',
      from(frame('app://mqtt-in/index.html', 2), frame('app://mqtt-in/index.html'))
    ],
    ['a frame that is gone', from(null, frame('app://mqtt-in/index.html'))]
  ])('makes every handler refuse %s', async (_name, event) => {
    for (const [channel, listener] of electron.handlers) {
      await expect(listener(event), channel).rejects.toThrow('Untrusted IPC sender')
    }
  })

  it("serves the app origin's main frame", async () => {
    const event = from(frame('app://mqtt-in/index.html#/settings'))
    const settings = await electron.handlers.get(IPC.settingsGet)?.(event)
    expect(settings).toMatchObject({ theme: expect.any(String) })
    expect(await electron.handlers.get(IPC.connectionsList)?.(event)).toEqual([])
    expect(await electron.handlers.get(IPC.appInfo)?.(event)).toMatchObject({ name: 'mqtt-in' })
  })
})
