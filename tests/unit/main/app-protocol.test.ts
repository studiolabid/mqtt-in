/**
 * The `app://mqtt-in` origin of the UI: the URL helpers, the path resolver (nothing outside the
 * renderer folder, whatever the encoding) and the request handler on a real temp folder.
 * Electron's protocol and net modules are mocked.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  APP_INDEX_URL,
  APP_ORIGIN,
  appPageUrl,
  httpOrigin,
  isAppUrl,
  isSameHttpOrigin,
  isUiUrl,
  resolveAppPath
} from '../../../src/main/app-origin'
import { registerAppScheme, respondWithAppFile } from '../../../src/main/app-protocol'

const electron = vi.hoisted(() => ({ registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() }))

vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
  protocol: {
    registerSchemesAsPrivileged: electron.registerSchemesAsPrivileged,
    handle: electron.handle
  }
}))

const ROOT = resolve(tmpdir(), 'mqtt-in-renderer')

describe('app origin URLs', () => {
  it('names the origin and the entry page', () => {
    expect(APP_ORIGIN).toBe('app://mqtt-in')
    expect(APP_INDEX_URL).toBe('app://mqtt-in/index.html')
    expect(appPageUrl()).toBe('app://mqtt-in/index.html')
    expect(appPageUrl('/connections/abc')).toBe('app://mqtt-in/index.html#/connections/abc')
  })

  it('recognizes app://mqtt-in URLs only', () => {
    for (const url of [
      'app://mqtt-in',
      'app://mqtt-in/',
      'app://mqtt-in/index.html#/x',
      'app://mqtt-in?x'
    ]) {
      expect(isAppUrl(url), url).toBe(true)
    }
    for (const url of [
      'app://evil/index.html',
      'app://mqtt-in.evil/index.html',
      'app://mqtt-in:8080/index.html',
      'app://user@mqtt-in/index.html',
      'APP://MQTTIN/index.html',
      'file:///C:/app/index.html',
      'https://mqtt-in/index.html',
      'mqtt-in/index.html',
      ''
    ]) {
      expect(isAppUrl(url), url).toBe(false)
    }
  })

  it('compares http(s) origins only (never the opaque "null" origin)', () => {
    expect(httpOrigin('http://localhost:5173/x')).toBe('http://localhost:5173')
    expect(httpOrigin('app://mqtt-in/')).toBeNull()
    expect(httpOrigin('not a url')).toBeNull()
    expect(isSameHttpOrigin('http://localhost:5173/#/x', 'http://localhost:5173')).toBe(true)
    expect(isSameHttpOrigin('http://localhost:5174/', 'http://localhost:5173')).toBe(false)
    expect(isSameHttpOrigin('http://localhost:5173/', undefined)).toBe(false)
    // Two non-special URLs both have the origin 'null' in Node: they must not count as equal.
    expect(isSameHttpOrigin('foo://bar/', 'foo://baz/')).toBe(false)
  })

  it('treats the app origin and the dev server as the UI', () => {
    expect(isUiUrl('app://mqtt-in/index.html')).toBe(true)
    expect(isUiUrl('http://localhost:5173/', 'http://localhost:5173/')).toBe(true)
    expect(isUiUrl('http://localhost:5173/')).toBe(false)
    expect(isUiUrl('file:///C:/mqtt-in/out/renderer/index.html')).toBe(false)
  })
})

describe('resolveAppPath', () => {
  it('resolves files inside the renderer folder', () => {
    expect(resolveAppPath(ROOT, 'app://mqtt-in/assets/index.js')).toBe(
      join(ROOT, 'assets', 'index.js')
    )
    expect(resolveAppPath(ROOT, 'app://mqtt-in/index.html?v=1#/x')).toBe(join(ROOT, 'index.html'))
    expect(resolveAppPath(ROOT, 'app://mqtt-in/')).toBe(join(ROOT, 'index.html'))
    expect(resolveAppPath(ROOT, 'app://mqtt-in')).toBe(join(ROOT, 'index.html'))
    expect(resolveAppPath(ROOT, 'app://mqtt-in/assets/a%20b.js')).toBe(
      join(ROOT, 'assets', 'a b.js')
    )
  })

  it.each([
    ['dot-dot', 'app://mqtt-in/../package.json'],
    ['dot-dot inside', 'app://mqtt-in/assets/../../package.json'],
    ['encoded dot-dot', 'app://mqtt-in/%2e%2e/package.json'],
    ['mixed-case encoded dot-dot', 'app://mqtt-in/%2E%2e/%2e%2E/package.json'],
    ['half-encoded dot-dot', 'app://mqtt-in/.%2e/package.json'],
    ['encoded slash', 'app://mqtt-in/..%2f..%2fpackage.json'],
    ['encoded back slash', 'app://mqtt-in/..%5c..%5cpackage.json'],
    ['back slash', 'app://mqtt-in/..\\..\\package.json'],
    ['single dot', 'app://mqtt-in/./index.html'],
    ['drive path', 'app://mqtt-in/C:/Windows/win.ini'],
    ['encoded drive path', 'app://mqtt-in/C%3A%5CWindows%5Cwin.ini'],
    ['absolute path after an encoded slash', 'app://mqtt-in/%2Fetc%2Fpasswd'],
    ['UNC path', 'app://mqtt-in//server/share/file'],
    ['NTFS stream', 'app://mqtt-in/index.html::$DATA'],
    ['NUL', 'app://mqtt-in/index.html%00.js'],
    ['control character', 'app://mqtt-in/a%0Ab.js'],
    ['trailing dot', 'app://mqtt-in/index.html.'],
    ['trailing space', 'app://mqtt-in/index.html%20'],
    ['dot-dot with a trailing space', 'app://mqtt-in/assets/..%20'],
    ['empty segment', 'app://mqtt-in/assets//index.js'],
    ['bad encoding', 'app://mqtt-in/%E0%A4%A.js'],
    ['other host', 'app://evil/index.html'],
    ['port', 'app://mqtt-in:1/index.html'],
    ['credentials', 'app://a@mqtt-in/index.html'],
    ['other scheme', 'file:///C:/Windows/win.ini']
  ])('refuses %s', (_name, url) => {
    expect(resolveAppPath(ROOT, url)).toBeNull()
  })

  it('never returns a path outside the root (any pair of tricky segments)', () => {
    const parts = ['a', '..', '%2e%2e', '%2e', '.%2e', '%2f', '%5c', '%3a', 'C:', 'x/..', '...', '']
    let resolved = 0
    for (const a of parts) {
      for (const b of parts) {
        const file = resolveAppPath(ROOT, `app://mqtt-in/${a}/${b}`)
        if (file === null) continue
        resolved++
        expect(file.startsWith(ROOT + sep), file).toBe(true)
      }
    }
    // Only plain names get through ('a/a'); '...' ends with a dot, which Windows would drop.
    expect(resolved).toBe(1)
  })
})

describe('respondWithAppFile', () => {
  let root: string
  const load = vi.fn(async (fileUrl: string) => new Response(`body of ${fileUrl}`, { status: 200 }))

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'mqtt-in-app-protocol-'))
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'index.html'), '<!doctype html>')
    writeFileSync(join(root, 'assets', 'index.js'), 'export {}')
    writeFileSync(join(root, '..', 'mqtt-in-app-protocol-secret.txt'), 'secret')
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(join(root, '..', 'mqtt-in-app-protocol-secret.txt'), { force: true })
  })

  it('serves a file of the folder through its file URL', async () => {
    const response = await respondWithAppFile(
      new Request('app://mqtt-in/assets/index.js'),
      root,
      load
    )
    const fileUrl = pathToFileURL(join(root, 'assets', 'index.js')).toString()
    expect(load).toHaveBeenLastCalledWith(fileUrl)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(`body of ${fileUrl}`)
  })

  it('serves the entry page for the origin root', async () => {
    await respondWithAppFile(new Request('app://mqtt-in/'), root, load)
    expect(load).toHaveBeenLastCalledWith(pathToFileURL(join(root, 'index.html')).toString())
  })

  it('answers HEAD without a body', async () => {
    const response = await respondWithAppFile(
      new Request('app://mqtt-in/index.html', { method: 'HEAD' }),
      root,
      load
    )
    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
  })

  it('refuses other methods', async () => {
    load.mockClear()
    const response = await respondWithAppFile(
      new Request('app://mqtt-in/index.html', { method: 'POST', body: 'x' }),
      root,
      load
    )
    expect(response.status).toBe(405)
    expect(load).not.toHaveBeenCalled()
  })

  it.each([
    ['a file outside the folder', 'app://mqtt-in/..%2fmqtt-in-app-protocol-secret.txt'],
    ['a missing file', 'app://mqtt-in/assets/missing.js'],
    ['a folder', 'app://mqtt-in/assets'],
    ['another host', 'app://evil/index.html']
  ])('fails the request (network error) for %s', async (_name, url) => {
    load.mockClear()
    const response = await respondWithAppFile(new Request(url), root, load)
    expect(response.type).toBe('error')
    expect(load).not.toHaveBeenCalled()
  })
})

describe('registerAppScheme', () => {
  it('registers app: as a privileged standard, secure scheme', () => {
    registerAppScheme()
    expect(electron.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: 'app',
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
          codeCache: true
        }
      }
    ])
  })
})
