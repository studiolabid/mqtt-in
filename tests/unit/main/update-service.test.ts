import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { UpdateState } from '@shared/models'
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  updateErrorMessage,
  UpdateService,
  updateSupport,
  type UpdateEvents,
  type UpdaterBackend
} from '../../../src/main/services/updater/update-service'

interface FakeBackend extends UpdaterBackend {
  events: UpdateEvents
  check: Mock<() => Promise<void>>
  quitAndInstall: Mock<() => void>
}

function fakeBackend(): FakeBackend {
  const backend: FakeBackend = {
    events: undefined as unknown as UpdateEvents,
    listen(events: UpdateEvents) {
      backend.events = events
    },
    check: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(() => undefined)
  }
  return backend
}

interface Harness {
  updates: UpdateService
  published: UpdateState[]
  shutdown: Mock<() => Promise<void>>
}

function service(
  backend: UpdaterBackend | null,
  overrides: { autoCheck?: () => boolean } = {}
): Harness {
  const published: UpdateState[] = []
  const shutdown: Mock<() => Promise<void>> = vi.fn(async () => undefined)
  const updates = new UpdateService({
    currentVersion: '1.2.0',
    backend,
    unsupportedReason: 'Development build',
    autoCheck: overrides.autoCheck ?? (() => true),
    publish: (state) => published.push(state),
    shutdown,
    now: () => 1000
  })
  return { updates, published, shutdown }
}

describe('updateSupport', () => {
  const base = { packaged: true, automated: false, platform: 'win32' }

  it('updates packaged Windows builds and AppImages', () => {
    expect(updateSupport(base)).toEqual({ supported: true })
    expect(updateSupport({ ...base, platform: 'linux', appImage: '/a.AppImage' }).supported).toBe(
      true
    )
  })

  it('refuses development builds, automated runs, macOS and Linux packages', () => {
    expect(updateSupport({ ...base, packaged: false }).supported).toBe(false)
    expect(updateSupport({ ...base, automated: true }).supported).toBe(false)
    expect(updateSupport({ ...base, platform: 'darwin' }).supported).toBe(false)
    expect(updateSupport({ ...base, platform: 'linux' }).supported).toBe(false)
  })
})

describe('updateErrorMessage', () => {
  it('turns common failures into short sentences', () => {
    expect(updateErrorMessage(new Error('Cannot find latest.yml in the latest release'))).toBe(
      'The latest release has no update files yet.'
    )
    expect(updateErrorMessage(new Error('getaddrinfo ENOTFOUND github.com'))).toMatch(
      /Could not reach GitHub/
    )
    expect(updateErrorMessage('x'.repeat(300))).toHaveLength(158)
  })
})

describe('UpdateService', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('is unsupported without a backend and never checks', async () => {
    const { updates } = service(null)
    expect(updates.getState()).toEqual({
      phase: 'unsupported',
      currentVersion: '1.2.0',
      message: 'Development build'
    })
    expect((await updates.check()).phase).toBe('unsupported')
    await expect(updates.install()).rejects.toThrow('No update is ready')
  })

  it('reports up to date', async () => {
    const backend = fakeBackend()
    backend.check.mockImplementation(async () => backend.events.notAvailable())
    const { updates } = service(backend)
    expect(await updates.check()).toEqual({
      phase: 'up-to-date',
      currentVersion: '1.2.0',
      checkedAt: 1000
    })
  })

  it('downloads a newer version and becomes ready', async () => {
    const backend = fakeBackend()
    backend.check.mockImplementation(async () => backend.events.available({ version: '1.3.0' }))
    const { updates, published } = service(backend)
    expect(await updates.check()).toMatchObject({ phase: 'downloading', version: '1.3.0' })
    backend.events.progress(42.7)
    expect(updates.getState().percent).toBe(42)
    backend.events.downloaded({ version: '1.3.0' })
    expect(updates.getState()).toMatchObject({ phase: 'ready', version: '1.3.0' })
    expect(published.map((s) => s.phase)).toEqual([
      'checking',
      'downloading',
      'downloading',
      'ready'
    ])
    // Nothing is checked again once an update is ready.
    await updates.check()
    expect(backend.check).toHaveBeenCalledTimes(1)
  })

  it('joins a running check', async () => {
    const backend = fakeBackend()
    const { updates } = service(backend)
    const a = updates.check()
    const b = updates.check()
    expect(a).toBe(b)
    await a
    expect(backend.check).toHaveBeenCalledTimes(1)
  })

  it('ends a failed check in the error phase (reported once)', async () => {
    const backend = fakeBackend()
    backend.check.mockImplementation(async () => {
      const err = new Error('getaddrinfo ENOTFOUND github.com')
      backend.events.error(err)
      throw err
    })
    const { updates, published } = service(backend)
    expect(await updates.check()).toMatchObject({
      phase: 'error',
      message: 'Could not reach GitHub. Check the internet connection.'
    })
    expect(published.filter((s) => s.phase === 'error')).toHaveLength(1)
  })

  it('shuts down gracefully before installing', async () => {
    const backend = fakeBackend()
    const { updates, shutdown } = service(backend)
    await expect(updates.install()).rejects.toThrow()
    backend.events.downloaded({ version: '1.3.0' })
    await updates.install()
    expect(shutdown).toHaveBeenCalledOnce()
    expect(backend.quitAndInstall).toHaveBeenCalledOnce()
    expect(shutdown.mock.invocationCallOrder[0]).toBeLessThan(
      backend.quitAndInstall.mock.invocationCallOrder[0]
    )
  })

  it('checks automatically after startup and periodically, only while enabled', async () => {
    const backend = fakeBackend()
    backend.check.mockImplementation(async () => backend.events.notAvailable())
    let enabled = false
    const { updates } = service(backend, { autoCheck: () => enabled })
    updates.start()
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS)
    expect(backend.check).not.toHaveBeenCalled()
    enabled = true
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    expect(backend.check).toHaveBeenCalledOnce()
    updates.stop()
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    expect(backend.check).toHaveBeenCalledOnce()
  })
})
