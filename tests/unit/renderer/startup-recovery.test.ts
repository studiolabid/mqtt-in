/**
 * Startup robustness: a navigation whose chunk cannot be loaded reloads once and then falls back
 * to the welcome screen with Retry (never a blank window), and "Connect on startup" connects its
 * profiles once per app run.
 */
import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { createConnectionProfile } from '@shared/defaults'
import { autoConnect, AUTO_CONNECT_KEY, firstStartOfRun } from '@/app/auto-connect'
import {
  installNavigationRecovery,
  isChunkLoadError,
  RELOAD_KEY,
  RELOAD_WINDOW_MS,
  shouldReload,
  type NavigationRecoveryDeps
} from '@/app/navigation-recovery'
import { parseConnectionProfile } from '../../../src/main/ipc/validate'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    }
  }
}

const CHUNK_ERROR = new TypeError(
  'Failed to fetch dynamically imported module: http://localhost:5173/src/features/workspace/ConnectionWorkspace.vue'
)

describe('chunk load errors', () => {
  it('recognizes the browsers’ messages only', () => {
    expect(isChunkLoadError(CHUNK_ERROR)).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/a.css'))).toBe(true)
    expect(isChunkLoadError(new Error('Connection not found'))).toBe(false)
  })

  it('reloads once per window of time, never without storage or for other errors', () => {
    const storage = memoryStorage()
    expect(shouldReload(CHUNK_ERROR, storage, 1000)).toBe(true)
    expect(storage.data.get(RELOAD_KEY)).toBe('1000')
    expect(shouldReload(CHUNK_ERROR, storage, 1000 + RELOAD_WINDOW_MS - 1)).toBe(false)
    expect(shouldReload(CHUNK_ERROR, storage, 1000 + RELOAD_WINDOW_MS)).toBe(true)
    expect(shouldReload(CHUNK_ERROR, null, 0)).toBe(false)
    expect(shouldReload(new Error('boom'), memoryStorage(), 0)).toBe(false)
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      }
    }
    expect(shouldReload(CHUNK_ERROR, broken, 0)).toBe(false)
  })
})

describe('navigation recovery', () => {
  function setup(load: () => Promise<unknown>): {
    router: Router
    deps: NavigationRecoveryDeps & { storage: () => ReturnType<typeof memoryStorage> }
  } {
    const component = { render: () => null }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'welcome', component },
        { path: '/connections/:id', name: 'connection', component: load }
      ]
    })
    const storage = memoryStorage()
    const deps = {
      storage: () => storage,
      now: () => 5000,
      reload: vi.fn(),
      report: vi.fn()
    }
    installNavigationRecovery(router, deps)
    return { router, deps }
  }

  it('reloads on the failed route first, then shows the welcome screen with Retry', async () => {
    const load = vi.fn((): Promise<unknown> => Promise.reject(CHUNK_ERROR))
    const { router, deps } = setup(load)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await router.push('/connections/c1').catch(() => undefined)
    expect(deps.reload).toHaveBeenCalledWith('/connections/c1')
    expect(deps.report).not.toHaveBeenCalled()

    // The reloaded window fails again (same run): no second reload.
    await router.push('/connections/c1').catch(() => undefined)
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('welcome'))
    expect(deps.reload).toHaveBeenCalledTimes(1)
    expect(deps.report).toHaveBeenCalledTimes(1)
    const [title, options] = vi.mocked(deps.report).mock.calls[0]
    expect(title).toBe('Could not open the connection')
    expect(options?.description).toMatch(/dynamically imported module/)

    // Retry navigates to the route again; this time the chunk loads.
    load.mockImplementation(() => Promise.resolve({ render: () => null }))
    const action = options?.action
    if (!action || typeof action !== 'object' || !('onClick' in action)) throw new Error('no Retry')
    expect(action.label).toBe('Retry')
    action.onClick({} as MouseEvent)
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/connections/c1'))
  })

  it('keeps the shown screen when a later navigation fails', async () => {
    const { router, deps } = setup(() => Promise.reject(new Error('guard failed')))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await router.push('/')
    await router.push('/connections/c1').catch(() => undefined)
    expect(deps.reload).not.toHaveBeenCalled()
    expect(deps.report).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('welcome')
  })
})

describe('connect on startup', () => {
  it('is the first start once per run', () => {
    const storage = memoryStorage()
    expect(firstStartOfRun(storage)).toBe(true)
    expect(storage.data.has(AUTO_CONNECT_KEY)).toBe(true)
    expect(firstStartOfRun(storage)).toBe(false)
    expect(firstStartOfRun(null)).toBe(true)
  })

  it('connects the marked profiles that are not active yet', async () => {
    const marked = createConnectionProfile({ name: 'Marked', autoConnect: true })
    const open = createConnectionProfile({ name: 'Open', autoConnect: true })
    const plain = createConnectionProfile({ name: 'Plain' })
    const connect = vi.fn(() => Promise.resolve(true))
    const ids = await autoConnect({
      profiles: [marked, open, plain],
      isActive: (id) => id === open.id,
      connect
    })
    expect(ids).toEqual([marked.id])
    expect(connect).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledWith(marked.id)
  })

  it('is stored with the profile', () => {
    const profile = createConnectionProfile({ host: 'broker.local' })
    expect(parseConnectionProfile({ ...profile, autoConnect: true }).autoConnect).toBe(true)
    expect(parseConnectionProfile(profile).autoConnect).toBeUndefined()
    expect(() => parseConnectionProfile({ ...profile, autoConnect: 'yes' })).toThrow()
  })
})
