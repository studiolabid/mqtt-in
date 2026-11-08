/**
 * One-time move of the user's data from the profile of the app's former name (mqtey) into the
 * mqtt-in profile, on the first start of mqtt-in.
 *
 * Copied: the storage files (`data/`: connections, settings, history) and `Local State`, which on
 * Windows holds the key that encrypts saved passwords, so they stay readable. Nothing else
 * (caches, Local Storage, logs). The old folder is only read, never changed.
 *
 * Must run synchronously before the app is ready: Electron reads `<userData>/Local State` only
 * after the main script's first synchronous run. On macOS and Linux the key lives in the OS
 * keychain under the app name, so migrated passwords there cannot be decrypted: the storage layer
 * shows them empty and keeps the stored value, like any unreadable secret.
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync
} from 'node:fs'
import { join } from 'node:path'

export type MigrationOutcome =
  | { migrated: true; files: number }
  | { migrated: false; reason: 'profile-has-data' | 'no-legacy-profile' }
  | { migrated: false; reason: 'failed'; error: string }

const DATA = 'data'
const LOCAL_STATE = 'Local State'

function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Copies `<from>/data` and `<from>/Local State` into `to` when `to` has no data yet. */
export function migrateLegacyProfile(from: string, to: string): MigrationOutcome {
  const target = join(to, DATA)
  if (existsSync(target)) return { migrated: false, reason: 'profile-has-data' }
  const source = join(from, DATA)
  if (!isDirectory(source)) return { migrated: false, reason: 'no-legacy-profile' }

  const staging = join(to, `${DATA}.migrating`)
  try {
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    let files = 0
    for (const name of readdirSync(source)) {
      // Regular files only: no symlinks (never followed) and no folders.
      if (!lstatSync(join(source, name)).isFile()) continue
      copyFileSync(join(source, name), join(staging, name))
      files += 1
    }
    const localState = join(from, LOCAL_STATE)
    if (existsSync(localState) && lstatSync(localState).isFile()) {
      // A profile without data/ holds no secrets yet, so its own key can be replaced.
      copyFileSync(localState, join(to, LOCAL_STATE))
    }
    renameSync(staging, target)
    return { migrated: true, files }
  } catch (err) {
    rmSync(staging, { recursive: true, force: true })
    return {
      migrated: false,
      reason: 'failed',
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
