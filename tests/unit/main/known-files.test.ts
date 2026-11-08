import { describe, expect, it } from 'vitest'
import { KnownFiles } from '../../../src/main/services/known-files'

describe('KnownFiles', () => {
  it('knows the absolute paths it was given, and nothing else', () => {
    const files = new KnownFiles('linux')
    files.remember('/home/me/export.json')
    expect(files.isKnown('/home/me/export.json')).toBe(true)
    expect(files.isKnown('/home/me/other.json')).toBe(false)
    expect(files.isKnown('/home/me')).toBe(false)
  })

  it('ignores relative and empty paths', () => {
    const files = new KnownFiles('linux')
    files.remember('export.json')
    files.remember('')
    expect(files.isKnown('export.json')).toBe(false)
    expect(files.isKnown('')).toBe(false)
    // A relative path is not resolved against the working directory.
    expect(files.isKnown('/export.json')).toBe(false)
  })

  it('compares normalized POSIX paths case-sensitively', () => {
    const files = new KnownFiles('linux')
    files.remember('/tmp/exports/../Out.json')
    expect(files.isKnown('/tmp/Out.json')).toBe(true)
    expect(files.isKnown('/tmp/./Out.json')).toBe(true)
    expect(files.isKnown('/tmp/out.json')).toBe(false)
  })

  it('compares Windows paths regardless of case and separators', () => {
    const files = new KnownFiles('win32')
    files.remember('C:\\Users\\Me\\Documents\\mqtt-in-connections.json')
    expect(files.isKnown('c:/users/me/documents/MQTT-IN-CONNECTIONS.json')).toBe(true)
    expect(files.isKnown('C:\\Users\\Me\\Documents\\x\\..\\mqtt-in-connections.json')).toBe(true)
    expect(files.isKnown('C:\\Users\\Me\\Documents\\other.json')).toBe(false)
    expect(files.isKnown('Documents\\mqtt-in-connections.json')).toBe(false)
  })

  it('forgets everything on clear()', () => {
    const files = new KnownFiles('linux')
    files.remember('/a.json')
    files.clear()
    expect(files.isKnown('/a.json')).toBe(false)
  })
})
