import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() })
}))

import type { ConnectionStatus } from '@shared/models'
import {
  ANNOUNCE_DELAY_MS,
  statusAnnouncement,
  useStatusAnnouncer,
  ZERO_WIDTH_SPACE
} from '@/features/shell/composables/useStatusAnnouncer'
import { useSessionsStore } from '@/stores'
import { setupStores } from '../../renderer/stores/setup'

describe('statusAnnouncement (A11Y-17)', () => {
  it.each<[ConnectionStatus | undefined, ConnectionStatus, string | null]>([
    ['connected', 'reconnecting', 'Lab: connection lost, reconnecting…'],
    ['reconnecting', 'connected', 'Lab: connected'],
    ['connecting', 'connected', 'Lab: connected'],
    ['connected', 'disconnected', 'Lab: disconnected'],
    ['disconnecting', 'disconnected', 'Lab: disconnected'],
    ['reconnecting', 'disconnected', 'Lab: disconnected'],
    // Not announced: restored sessions, steps in between, and failures (they raise a toast).
    [undefined, 'connected', null],
    ['disconnected', 'connecting', null],
    ['connected', 'disconnecting', null],
    ['connecting', 'error', null],
    ['connected', 'connected', null]
  ])('%s → %s', (previous, next, text) => {
    expect(statusAnnouncement('Lab', previous, next)).toBe(text)
  })
})

describe('useStatusAnnouncer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  async function start(): Promise<{
    id: string
    message: () => string
    status: (status: ConnectionStatus) => Promise<void>
    stop: () => void
  }> {
    const { profiles } = await setupStores([{ name: 'Lab' }])
    const id = profiles[0].id
    const sessions = useSessionsStore()
    const scope = effectScope()
    const announcer = scope.run(() => useStatusAnnouncer())
    if (!announcer) throw new Error('no announcer')
    return {
      id,
      message: () => announcer.message.value,
      status: async (status) => {
        sessions.handleStatus({ connectionId: id, status, timestamp: Date.now() })
        await nextTick()
      },
      stop: () => scope.stop()
    }
  }

  it('announces a lost connection once it holds', async () => {
    const run = await start()
    await run.status('connecting')
    await run.status('connected')
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS)
    expect(run.message()).toBe('Lab: connected')
    await run.status('reconnecting')
    expect(run.message()).toBe('Lab: connected')
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS)
    expect(run.message()).toBe('Lab: connection lost, reconnecting…')
    run.stop()
  })

  it('announces only the settled state of a flapping session', async () => {
    const run = await start()
    await run.status('connecting')
    await run.status('connected')
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS)
    await run.status('reconnecting')
    await run.status('connected')
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS)
    // The same text again: changed invisibly so screen readers read it again.
    expect(run.message()).toBe(`Lab: connected${ZERO_WIDTH_SPACE}`)
    expect(run.message()).not.toBe('Lab: connected')
    run.stop()
  })

  it('announces a disconnect', async () => {
    const run = await start()
    await run.status('connecting')
    await run.status('connected')
    await run.status('disconnecting')
    await run.status('disconnected')
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS)
    expect(run.message()).toBe('Lab: disconnected')
    run.stop()
  })
})
