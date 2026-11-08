import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrateLegacyProfile } from '../../../src/main/profile-migration'

let root: string
let legacy: string
let profile: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mqtt-in-migration-'))
  legacy = join(root, 'mqtey')
  profile = join(root, 'mqtt-in')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function seedLegacy(): void {
  mkdirSync(join(legacy, 'data'), { recursive: true })
  mkdirSync(join(legacy, 'Cache'), { recursive: true })
  writeFileSync(join(legacy, 'data', 'connections.json'), '{"connections":[]}')
  writeFileSync(join(legacy, 'data', 'connections.json.bak'), '{"connections":[]}')
  writeFileSync(join(legacy, 'data', 'settings.json'), '{"theme":"dark"}')
  writeFileSync(join(legacy, 'Local State'), '{"os_crypt":{"encrypted_key":"k"}}')
  writeFileSync(join(legacy, 'Cache', 'blob'), 'cache')
}

function snapshot(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((name) => `${name}:${statSync(join(dir, name)).size}`)
    .sort()
}

describe('migrateLegacyProfile', () => {
  it('copies the data files and Local State, nothing else, and leaves the old folder as it was', () => {
    seedLegacy()
    const before = snapshot(legacy)

    expect(migrateLegacyProfile(legacy, profile)).toEqual({ migrated: true, files: 3 })

    expect(readdirSync(join(profile, 'data')).sort()).toEqual([
      'connections.json',
      'connections.json.bak',
      'settings.json'
    ])
    expect(readFileSync(join(profile, 'data', 'settings.json'), 'utf8')).toBe('{"theme":"dark"}')
    expect(readFileSync(join(profile, 'Local State'), 'utf8')).toContain('encrypted_key')
    expect(readdirSync(profile).sort()).toEqual(['Local State', 'data'])
    expect(snapshot(legacy)).toEqual(before)
  })

  it('replaces the Local State of a profile that has no data yet', () => {
    seedLegacy()
    mkdirSync(join(profile, 'logs'), { recursive: true })
    writeFileSync(join(profile, 'Local State'), '{"fresh":true}')

    expect(migrateLegacyProfile(legacy, profile).migrated).toBe(true)
    expect(readFileSync(join(profile, 'Local State'), 'utf8')).toContain('encrypted_key')
  })

  it('never runs again once the profile has data', () => {
    seedLegacy()
    mkdirSync(join(profile, 'data'), { recursive: true })
    writeFileSync(join(profile, 'data', 'connections.json'), '{"mine":true}')

    expect(migrateLegacyProfile(legacy, profile)).toEqual({
      migrated: false,
      reason: 'profile-has-data'
    })
    expect(readFileSync(join(profile, 'data', 'connections.json'), 'utf8')).toBe('{"mine":true}')
  })

  it('does nothing without an old profile', () => {
    expect(migrateLegacyProfile(legacy, profile)).toEqual({
      migrated: false,
      reason: 'no-legacy-profile'
    })
    expect(() => readdirSync(profile)).toThrow()
  })

  it('leaves no partial data behind when copying fails', () => {
    seedLegacy()
    // A file named like the staging folder's parent makes every write below it fail.
    writeFileSync(profile, 'not a folder')

    const outcome = migrateLegacyProfile(legacy, profile)

    expect(outcome).toMatchObject({ migrated: false, reason: 'failed' })
    expect(statSync(profile).isFile()).toBe(true)
  })

  it('does not follow symlinks in the old data folder', () => {
    seedLegacy()
    const outside = join(root, 'secret.txt')
    writeFileSync(outside, 'secret')
    let linked = true
    try {
      symlinkSync(outside, join(legacy, 'data', 'link.json'))
    } catch {
      linked = false // symlinks need extra rights on Windows
    }

    expect(migrateLegacyProfile(legacy, profile)).toEqual({ migrated: true, files: 3 })
    if (linked) expect(readdirSync(join(profile, 'data'))).not.toContain('link.json')
  })
})
