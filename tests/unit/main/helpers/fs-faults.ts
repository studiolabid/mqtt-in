/**
 * A pass-through `node:fs` for `vi.mock` whose calls can fail on demand (a locked file, a failing
 * write…) and are spied on, so tests can check what the storage did and in which order:
 *
 *   vi.mock('node:fs', async (importOriginal) =>
 *     (await import('./helpers/fs-faults')).faultyFs(await importOriginal()))
 *
 * Set `fsFaults.<call>` to a function of the path that returns the error to throw (or
 * `undefined` to let the call through); `resetFsFaults()` clears them.
 */
import type * as fs from 'node:fs'
import { vi } from 'vitest'

export type FsCall = 'readFileSync' | 'openSync' | 'fsyncSync' | 'renameSync' | 'copyFileSync'

export type FsFault = (path: string) => Error | undefined

export const fsFaults: Partial<Record<FsCall, FsFault>> = {}

export function resetFsFaults(): void {
  for (const key of Object.keys(fsFaults) as FsCall[]) delete fsFaults[key]
}

/** A Node-style error, e.g. `errno('EBUSY', path)` (EBUSY: resource busy or locked). */
export function errno(code: string, path = ''): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulated failure, '${path}'`), { code })
}

/** Fails `count` calls for paths that end with `suffix`, then lets them through. */
export function failTimes(count: number, suffix: string, code = 'EBUSY'): FsFault {
  let left = count
  return (path) => {
    if (!path.endsWith(suffix) || left <= 0) return undefined
    left--
    return errno(code, path)
  }
}

/** Fails every call for paths that end with `suffix`. */
export function failAlways(suffix: string, code = 'EBUSY'): FsFault {
  return (path) => (path.endsWith(suffix) ? errno(code, path) : undefined)
}

type Call = (...args: unknown[]) => unknown

export function faultyFs(actual: typeof fs): typeof fs {
  const wrap = (name: FsCall): Call => {
    const real = actual[name] as unknown as Call
    return vi.fn((...args: unknown[]) => {
      const error = fsFaults[name]?.(String(args[0]))
      if (error) throw error
      return real(...args)
    })
  }
  return {
    ...actual,
    readFileSync: wrap('readFileSync'),
    openSync: wrap('openSync'),
    fsyncSync: wrap('fsyncSync'),
    renameSync: wrap('renameSync'),
    copyFileSync: wrap('copyFileSync')
  } as unknown as typeof fs
}
