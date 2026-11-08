/**
 * The packaging configuration, read as text (no YAML or plist parser): Electron fuses, the
 * `files` allowlist and the locales of electron-builder.yml, the NSIS desktop shortcut, and the
 * macOS hardened runtime with the smallest set of entitlements (no DYLD_* injection).
 * The packaged binary itself is checked by the packaging smoke test (IN-09).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8')

const BUILDER = read('electron-builder.yml').replace(/\r\n/g, '\n')
const PLIST = read('build/entitlements.mac.plist')

/** The `key: value` lines (or `- item` lines) directly under a top-level `section:`. */
function section(name: string): string[] {
  const lines = BUILDER.split('\n')
  const start = lines.indexOf(`${name}:`)
  if (start < 0) throw new Error(`No "${name}:" section`)
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) body.push(trimmed)
  }
  return body
}

function entries(name: string): Record<string, string> {
  return Object.fromEntries(
    section(name).map((line) => {
      const [key, ...value] = line.split(':')
      return [key.trim(), value.join(':').trim()]
    })
  )
}

const listItems = (name: string): string[] =>
  section(name).map((line) => line.replace(/^-\s*/, '').replace(/^'(.*)'$/, '$1'))

describe('electron-builder.yml', () => {
  it('sets the Electron fuses of the packaged executable', () => {
    expect(entries('electronFuses')).toEqual({
      runAsNode: 'false',
      enableNodeOptionsEnvironmentVariable: 'false',
      enableNodeCliInspectArguments: 'false',
      enableEmbeddedAsarIntegrityValidation: 'true',
      onlyLoadAppFromAsar: 'true',
      // The UI is served from app://mqtt-in (src/main/app-protocol.ts), not file://.
      grantFileProtocolExtraPrivileges: 'false'
    })
  })

  it('packages an allowlist: the build, resources and package.json, without source maps', () => {
    const files = listItems('files')
    expect(files.slice(0, 4)).toEqual(['out/**', 'resources/**', 'package.json', '!**/*.map'])
    expect(files.filter((pattern) => !pattern.startsWith('!'))).toEqual([
      'out/**',
      'resources/**',
      'package.json'
    ])
    // Throwaway builds (out-*) and everything else stay out: no catch-all pattern.
    expect(files).not.toContain('**/*')
    expect(files.some((pattern) => /^out-|^out\*/.test(pattern))).toBe(false)
  })

  it('trims node_modules but keeps the dependency licenses', () => {
    const files = listItems('files')
    expect(files).toEqual(
      expect.arrayContaining([
        '!node_modules/mqtt/dist/**',
        '!node_modules/**/*.{ts,tsbuildinfo}',
        '!node_modules/**/{test,tests,__tests__,benchmarks,example,examples}/**',
        '!node_modules/mqtt-packet/test.js',
        '!node_modules/**/{CHANGELOG,CONTRIBUTING,HISTORY}*.md'
      ])
    )
    expect(files.some((pattern) => /^!.*\*\*\/\*\.md$/.test(pattern))).toBe(false)
    expect(files.some((pattern) => /LICEN[CS]E/i.test(pattern))).toBe(false)
  })

  it('ships the en-US locale only', () => {
    expect(listItems('electronLanguages')).toEqual(['en-US'])
  })

  it('creates the desktop shortcut once (a deleted one stays deleted)', () => {
    expect(entries('nsis').createDesktopShortcut).toBe('true')
    expect(BUILDER).not.toMatch(/createDesktopShortcut:\s*always/)
  })

  it('signs macOS builds with the hardened runtime and the entitlements file', () => {
    const mac = entries('mac')
    expect(mac.hardenedRuntime).toBe('true')
    expect(mac.entitlements).toBe('build/entitlements.mac.plist')
    expect(mac.entitlementsInherit).toBe('build/entitlements.mac.plist')
  })
})

describe('build/entitlements.mac.plist', () => {
  it('grants exactly what V8 needs: JIT and unsigned executable memory', () => {
    const keys = [...PLIST.matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1])
    expect(keys).toEqual([
      'com.apple.security.cs.allow-jit',
      'com.apple.security.cs.allow-unsigned-executable-memory'
    ])
    expect(PLIST).not.toContain('allow-dyld-environment-variables')
    expect(PLIST).not.toContain('disable-library-validation')
  })

  it('enables each of them', () => {
    const values = [...PLIST.matchAll(/<\/key>\s*<(\w+)\s*\/>/g)].map((match) => match[1])
    expect(values).toEqual(['true', 'true'])
  })
})
