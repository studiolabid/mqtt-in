/**
 * The files this process wrote or reported in this session: files saved through a save dialog,
 * connection exports and the paths of storage notices. `app.showItemInFolder` reveals only
 * these, so the renderer can never make the main process probe or open arbitrary paths.
 * Pure (node:path only).
 */
import { posix, win32 } from 'node:path'

export class KnownFiles {
  private readonly paths = new Set<string>()
  private readonly path: typeof posix

  /** @param platform path rules to apply (the host's by default). */
  constructor(private readonly platform: NodeJS.Platform = process.platform) {
    this.path = platform === 'win32' ? win32 : posix
  }

  /** Adds an absolute path (relative paths are ignored: they name no particular file). */
  remember(path: string): void {
    const key = this.key(path)
    if (key !== null) this.paths.add(key)
  }

  /** True when `path` (absolute) was remembered in this session. */
  isKnown(path: string): boolean {
    const key = this.key(path)
    return key !== null && this.paths.has(key)
  }

  /** Forgets every path (tests). */
  clear(): void {
    this.paths.clear()
  }

  /** Normalized separators and `..` segments; Windows paths compare case-insensitively. */
  private key(path: string): string | null {
    if (typeof path !== 'string' || path === '' || !this.path.isAbsolute(path)) return null
    const normalized = this.path.normalize(path)
    return this.platform === 'win32' ? normalized.toLowerCase() : normalized
  }
}

/** The registry of this process. */
export const knownFiles = new KnownFiles()
