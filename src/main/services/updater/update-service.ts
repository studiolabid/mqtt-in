/**
 * Self-update from the GitHub releases: a check shortly after startup and then every few hours
 * (when `settings.autoUpdate` is on), a newer version downloads in the background, and it is
 * installed on "Restart & update" or, failing that, when the app quits.
 *
 * The update backend (electron-updater) sits behind `UpdaterBackend`, so the service is plain,
 * testable logic. Installing first runs the app's graceful shutdown (`shutdown`: disconnect,
 * flush storage) — the installer replaces the program files only; the profile folder with the
 * connections, settings and history is never touched.
 */
import type { UpdateState } from '@shared/models'

/** First automatic check after startup (lets the window and connections settle first). */
export const FIRST_CHECK_DELAY_MS = 20_000
/** Later automatic checks. */
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

export interface UpdateInfo {
  version: string
}

/** What the backend reports while checking and downloading. */
export interface UpdateEvents {
  checking(): void
  available(info: UpdateInfo): void
  notAvailable(): void
  /** Download progress 0–100. */
  progress(percent: number): void
  downloaded(info: UpdateInfo): void
  error(err: unknown): void
}

export interface UpdaterBackend {
  /** Registers the event handlers (once). */
  listen(events: UpdateEvents): void
  /** Checks the feed; a newer version starts downloading. Rejects on failure. */
  check(): Promise<void>
  /** Quits the app, runs the downloaded installer silently and starts the new version. */
  quitAndInstall(): void
}

export type UpdateSupport = { supported: true } | { supported: false; reason: string }

export interface UpdateSupportInput {
  packaged: boolean
  /** `MQTTIN_E2E=1` or an isolated profile (`MQTTIN_USER_DATA_DIR`). */
  automated: boolean
  platform: string
  /** `process.env.APPIMAGE` (set when running from an AppImage). */
  appImage?: string
}

/** Whether this build can update itself, and why not. */
export function updateSupport(input: UpdateSupportInput): UpdateSupport {
  if (!input.packaged) {
    return { supported: false, reason: 'Development build: updates come with the installer.' }
  }
  if (input.automated) return { supported: false, reason: 'Updates are off in automated runs.' }
  if (input.platform === 'win32') return { supported: true }
  if (input.platform === 'linux' && input.appImage) return { supported: true }
  if (input.platform === 'darwin') {
    return { supported: false, reason: 'Download new versions from the GitHub releases.' }
  }
  return {
    supported: false,
    reason: 'Update with your package manager or download the GitHub release.'
  }
}

/** A short, human message for a failed check or download. */
export function updateErrorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  if (/latest(-\w+)?\.yml|Cannot find .*\.yml|No published versions/i.test(text)) {
    return 'The latest release has no update files yet.'
  }
  if (
    /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|net::ERR_|socket hang up/i.test(text)
  ) {
    return 'Could not reach GitHub. Check the internet connection.'
  }
  if (/sha512 checksum mismatch/i.test(text)) return 'The download was damaged. Try again.'
  const line = text.split('\n')[0]?.trim() || 'Unknown error'
  return line.length > 160 ? `${line.slice(0, 157)}…` : line
}

export interface UpdateServiceOptions {
  currentVersion: string
  /** `null` when this build cannot update itself (`unsupportedReason` says why). */
  backend: UpdaterBackend | null
  unsupportedReason?: string
  /** Whether automatic checks are on (`settings.autoUpdate`), read before every check. */
  autoCheck: () => boolean
  /** Sends every state change to the windows. */
  publish: (state: UpdateState) => void
  /** The app's graceful shutdown (disconnect sessions, flush storage). */
  shutdown: () => Promise<void>
  log?: (kind: string, detail?: unknown) => void
  now?: () => number
}

export class UpdateService {
  private state: UpdateState
  private inFlight: Promise<UpdateState> | null = null
  private timers: ReturnType<typeof setTimeout>[] = []
  private installing = false

  constructor(private readonly options: UpdateServiceOptions) {
    this.state = options.backend
      ? { phase: 'idle', currentVersion: options.currentVersion }
      : {
          phase: 'unsupported',
          currentVersion: options.currentVersion,
          message: options.unsupportedReason
        }
    options.backend?.listen({
      checking: () => this.set({ phase: 'checking' }),
      available: (info) => this.set({ phase: 'downloading', version: info.version, percent: 0 }),
      notAvailable: () => this.set({ phase: 'up-to-date', checkedAt: this.now() }),
      progress: (percent) => {
        if (this.state.phase !== 'downloading') return
        const rounded = Math.max(0, Math.min(100, Math.floor(percent)))
        if (rounded !== this.state.percent) this.set({ ...this.state, percent: rounded })
      },
      downloaded: (info) =>
        this.set({ phase: 'ready', version: info.version, checkedAt: this.now() }),
      error: (err) => {
        // electron-updater emits errors and also rejects the check: report once.
        this.options.log?.('update-error', updateErrorMessage(err))
        this.set({ phase: 'error', message: updateErrorMessage(err), checkedAt: this.now() })
      }
    })
  }

  getState(): UpdateState {
    return { ...this.state }
  }

  /** Starts the automatic checks (no-op when unsupported). */
  start(): void {
    if (!this.options.backend || this.timers.length > 0) return
    const tick = (): void => {
      if (this.options.autoCheck()) void this.check()
    }
    this.timers.push(setTimeout(tick, FIRST_CHECK_DELAY_MS))
    this.timers.push(setInterval(tick, CHECK_INTERVAL_MS))
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
  }

  /**
   * Checks now. A check already running is joined; while a download runs or an update is ready
   * nothing is checked again. Never rejects: failures end in the `error` phase.
   */
  check(): Promise<UpdateState> {
    const backend = this.options.backend
    if (!backend) return Promise.resolve(this.getState())
    if (this.inFlight) return this.inFlight
    if (this.state.phase === 'downloading' || this.state.phase === 'ready') {
      return Promise.resolve(this.getState())
    }
    this.set({ phase: 'checking' })
    this.inFlight = backend
      .check()
      .then(() => {
        // The backend normally reported the outcome already; never stay in `checking`.
        if (this.state.phase === 'checking') {
          this.set({ phase: 'up-to-date', checkedAt: this.now() })
        }
      })
      .catch((err: unknown) => {
        if (this.state.phase !== 'error') {
          this.options.log?.('update-error', updateErrorMessage(err))
          this.set({ phase: 'error', message: updateErrorMessage(err), checkedAt: this.now() })
        }
      })
      .then(() => this.getState())
      .finally(() => {
        this.inFlight = null
      })
    return this.inFlight
  }

  /** Shuts the app down gracefully, then installs the downloaded update and restarts. */
  async install(): Promise<void> {
    const backend = this.options.backend
    if (!backend || this.state.phase !== 'ready') throw new Error('No update is ready to install')
    if (this.installing) return
    this.installing = true
    this.stop()
    this.options.log?.('update-install', {
      from: this.state.currentVersion,
      to: this.state.version
    })
    try {
      await this.options.shutdown()
    } finally {
      backend.quitAndInstall()
    }
  }

  private set(next: Omit<UpdateState, 'currentVersion'>): void {
    this.state = { ...next, currentVersion: this.options.currentVersion }
    this.options.publish(this.getState())
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}
