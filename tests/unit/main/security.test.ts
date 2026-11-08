/**
 * The security policy of the main process on fake web contents, frames and sessions:
 * - the IPC sender guard trusts the main frame of the app origin (or the dev server) only;
 * - navigations are blocked without ever opening the browser; subframes never navigate;
 * - window.open is denied (http(s) links open in the browser); webviews are blocked;
 * - every permission is denied except writing to the clipboard.
 * Electron's shell is mocked (nothing is ever opened).
 */
import { EventEmitter } from 'node:events'
import type { App, Session, WebContents, WebFrameMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSenderGuard, type SenderEvent } from '../../../src/main/ipc/handle'
import {
  ALLOWED_PERMISSIONS,
  applySessionPolicy,
  guardNewWebContents,
  hardenWebContents
} from '../../../src/main/security'

const electron = vi.hoisted(() => ({ openExternal: vi.fn(async () => undefined) }))

vi.mock('electron', () => ({
  shell: { openExternal: electron.openExternal },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: { fromWebContents: () => null }
}))

const DEV = 'http://localhost:5173/'

// --- IPC sender guard ---------------------------------------------------------------------------

function frame(url: string, routingId = 1, processId = 7): WebFrameMain {
  return { url, routingId, processId } as unknown as WebFrameMain
}

function event(sender: WebFrameMain | null, main: WebFrameMain | null = sender): SenderEvent {
  return { senderFrame: sender, sender: { mainFrame: main } } as SenderEvent
}

describe('createSenderGuard', () => {
  const guard = createSenderGuard()

  it("accepts the app origin's main frame", () => {
    const main = frame('app://mqtt-in/index.html#/connections/abc')
    expect(guard(event(main))).toBe(true)
    // Another WebFrameMain object for the same frame (same process and routing id).
    expect(guard(event(frame('app://mqtt-in/index.html'), frame('app://mqtt-in/index.html')))).toBe(
      true
    )
  })

  it('rejects subframes, even of the app origin', () => {
    const main = frame('app://mqtt-in/index.html', 1)
    expect(guard(event(frame('app://mqtt-in/index.html', 2), main))).toBe(false)
    expect(guard(event(frame('app://mqtt-in/index.html', 1, 8), main))).toBe(false)
  })

  it('rejects a missing frame or a sender without a main frame', () => {
    expect(guard(event(null, frame('app://mqtt-in/index.html')))).toBe(false)
    expect(guard(event(frame('app://mqtt-in/index.html'), null))).toBe(false)
    expect(guard({ senderFrame: frame('app://mqtt-in/index.html') } as SenderEvent)).toBe(false)
  })

  it.each([
    'file:///C:/Users/me/out/renderer/index.html',
    'file:///C:/Users/me/Downloads/evil.html',
    'https://example.com/',
    'http://localhost:5173/',
    'app://evil/index.html',
    'app://mqtt-in.evil/index.html',
    'app://mqtt-in:1/index.html',
    'data:text/html,<p>x</p>',
    'about:blank',
    'devtools://devtools/bundled/devtools_app.html',
    ''
  ])('rejects a main frame on %s', (url) => {
    expect(guard(event(frame(url)))).toBe(false)
  })

  it("accepts the dev server's origin in development only", () => {
    const dev = createSenderGuard(DEV)
    expect(dev(event(frame('http://localhost:5173/#/settings')))).toBe(true)
    expect(dev(event(frame('app://mqtt-in/index.html')))).toBe(true)
    expect(dev(event(frame('http://localhost:5174/')))).toBe(false)
    expect(dev(event(frame('http://localhost:5173/', 2), frame(DEV, 1)))).toBe(false)
  })

  it('never trusts the opaque origin of a non-http "dev server"', () => {
    const odd = createSenderGuard('foo://bar/')
    expect(odd(event(frame('foo://bar/')))).toBe(false)
    expect(odd(event(frame('evil://x/')))).toBe(false)
  })
})

// --- web contents hardening ----------------------------------------------------------------------

interface NavigationEvent {
  url: string
  isMainFrame?: boolean
  preventDefault: ReturnType<typeof vi.fn>
}

type OpenHandler = (details: { url: string }) => { action: string }

class FakeContents extends EventEmitter {
  openHandler: OpenHandler | null = null
  constructor(private url = 'app://mqtt-in/index.html') {
    super()
  }
  getURL(): string {
    return this.url
  }
  setWindowOpenHandler(handler: OpenHandler): void {
    this.openHandler = handler
  }
  navigate(
    name: 'will-navigate' | 'will-frame-navigate',
    url: string,
    isMainFrame = true
  ): NavigationEvent {
    const nav: NavigationEvent = { url, isMainFrame, preventDefault: vi.fn() }
    this.emit(name, nav)
    return nav
  }
}

function harden(devServerUrl?: string, url?: string): FakeContents {
  const contents = new FakeContents(url)
  hardenWebContents(contents as unknown as WebContents, devServerUrl)
  return contents
}

beforeEach(() => {
  electron.openExternal.mockClear()
})

describe('hardenWebContents', () => {
  it.each([
    'https://example.com/',
    'http://example.org/x',
    'file:///C:/Windows/win.ini',
    'app://mqtt-in/index.html',
    'ms-settings:privacy'
  ])('blocks a navigation to %s without opening the browser', (url) => {
    const contents = harden()
    const nav = contents.navigate('will-navigate', url)
    expect(nav.preventDefault).toHaveBeenCalled()
    expect(electron.openExternal).not.toHaveBeenCalled()
  })

  it("allows the dev server's own navigations (full reloads) in development", () => {
    const contents = harden(DEV, DEV)
    expect(
      contents.navigate('will-navigate', 'http://localhost:5173/').preventDefault
    ).not.toHaveBeenCalled()
    expect(
      contents.navigate('will-navigate', 'http://localhost:5174/').preventDefault
    ).toHaveBeenCalled()
    expect(
      contents.navigate('will-navigate', 'https://example.com/').preventDefault
    ).toHaveBeenCalled()
    expect(electron.openExternal).not.toHaveBeenCalled()
  })

  it('blocks every subframe navigation and leaves the main frame to will-navigate', () => {
    const contents = harden()
    for (const url of ['file:///C:/Windows/win.ini', 'app://mqtt-in/index.html', 'about:blank']) {
      expect(contents.navigate('will-frame-navigate', url, false).preventDefault).toHaveBeenCalled()
    }
    expect(
      contents.navigate('will-frame-navigate', 'app://mqtt-in/index.html', true).preventDefault
    ).not.toHaveBeenCalled()
  })

  it('denies window.open and opens only http(s) links in the browser', () => {
    const contents = harden()
    for (const url of [
      'https://example.com/docs',
      'http://example.org/',
      'file:///C:/Windows/win.ini',
      'javascript:alert(1)',
      'mailto:a@b.c',
      'app://mqtt-in/index.html'
    ]) {
      expect(contents.openHandler?.({ url })).toEqual({ action: 'deny' })
    }
    expect(electron.openExternal.mock.calls).toEqual([
      ['https://example.com/docs'],
      ['http://example.org/']
    ])
  })

  it('blocks webviews', () => {
    const contents = harden()
    const attach = { preventDefault: vi.fn() }
    contents.emit('will-attach-webview', attach)
    expect(attach.preventDefault).toHaveBeenCalled()
  })

  it('hardens a web contents once, however often it is called', () => {
    const contents = harden()
    hardenWebContents(contents as unknown as WebContents)
    expect(contents.listenerCount('will-navigate')).toBe(1)
    expect(contents.listenerCount('will-frame-navigate')).toBe(1)
    expect(contents.listenerCount('will-attach-webview')).toBe(1)
  })

  it("leaves DevTools' own frontend free to navigate its frames (development)", () => {
    const contents = harden(undefined, 'devtools://devtools/bundled/devtools_app.html')
    expect(
      contents.navigate('will-frame-navigate', 'about:srcdoc', false).preventDefault
    ).not.toHaveBeenCalled()
    expect(
      contents.navigate('will-navigate', 'devtools://devtools/x').preventDefault
    ).not.toHaveBeenCalled()
  })
})

describe('guardNewWebContents', () => {
  it('applies the full hardening to every web contents created later', () => {
    const app = new EventEmitter()
    guardNewWebContents(app as unknown as App, DEV)
    const contents = new FakeContents()
    app.emit('web-contents-created', {}, contents)
    expect(
      contents.navigate('will-navigate', 'https://example.com/').preventDefault
    ).toHaveBeenCalled()
    expect(
      contents.navigate('will-frame-navigate', 'about:blank', false).preventDefault
    ).toHaveBeenCalled()
    expect(contents.navigate('will-navigate', DEV).preventDefault).not.toHaveBeenCalled()
    expect(contents.openHandler?.({ url: 'https://example.com/' })).toEqual({ action: 'deny' })
    expect(electron.openExternal).toHaveBeenCalledTimes(1)
  })
})

// --- permissions ---------------------------------------------------------------------------------

/** Every permission name Electron passes to the handlers (and a few unknown ones). */
const PERMISSIONS = [
  'clipboard-read',
  'clipboard-sanitized-write',
  'deprecated-sync-clipboard-read',
  'display-capture',
  'fileSystem',
  'fullscreen',
  'geolocation',
  'hid',
  'idle-detection',
  'keyboardLock',
  'media',
  'mediaKeySystem',
  'midi',
  'midiSysex',
  'notifications',
  'openExternal',
  'pointerLock',
  'serial',
  'speaker-selection',
  'storage-access',
  'top-level-storage-access',
  'usb',
  'window-management',
  'unknown',
  'camera',
  'microphone'
]

describe('applySessionPolicy', () => {
  type RequestHandler = (c: unknown, p: string, callback: (granted: boolean) => void) => void
  type CheckHandler = (c: unknown, p: string) => boolean

  function policy(): { request: RequestHandler; check: CheckHandler } {
    let request: RequestHandler | null = null
    let check: CheckHandler | null = null
    const session = {
      setPermissionRequestHandler: (handler: RequestHandler) => (request = handler),
      setPermissionCheckHandler: (handler: CheckHandler) => (check = handler)
    }
    applySessionPolicy(session as unknown as Session)
    if (!request || !check) throw new Error('handlers not set')
    return { request, check }
  }

  it('allows exactly one permission: writing to the clipboard', () => {
    expect([...ALLOWED_PERMISSIONS]).toEqual(['clipboard-sanitized-write'])
  })

  it('grants only clipboard-sanitized-write on request', () => {
    const { request } = policy()
    const granted = PERMISSIONS.filter((permission) => {
      let answer: boolean | null = null
      request(null, permission, (value) => (answer = value))
      return answer === true
    })
    expect(granted).toEqual(['clipboard-sanitized-write'])
  })

  it('answers permission checks the same way', () => {
    const { check } = policy()
    expect(PERMISSIONS.filter((permission) => check(null, permission))).toEqual([
      'clipboard-sanitized-write'
    ])
  })
})
