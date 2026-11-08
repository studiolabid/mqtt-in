import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { notifyConnectionRemoved } from '@/stores/connection-lifecycle'
import { useUiStore } from '@/stores/ui'
import { setupStores } from './setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

describe('useUiStore message export requests (CT-17)', () => {
  beforeEach(async () => {
    await setupStores()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('counts requests per connection and keeps the last format', () => {
    const ui = useUiStore()
    expect(ui.messageExportRequest('a')).toBeNull()
    ui.requestMessageExport('a', 'json')
    expect(ui.messageExportRequest('a')).toEqual({ seq: 1, format: 'json' })
    ui.requestMessageExport('a', 'csv')
    expect(ui.messageExportRequest('a')).toEqual({ seq: 2, format: 'csv' })
    // The same format again is a new request (the watcher sees a new seq).
    ui.requestMessageExport('a', 'csv')
    expect(ui.messageExportRequest('a')?.seq).toBe(3)
    expect(ui.messageExportRequest('b')).toBeNull()
  })

  it('is reactive and pruned with the connection', () => {
    const ui = useUiStore()
    const request = computed(() => ui.messageExportRequest('a')?.seq ?? 0)
    expect(request.value).toBe(0)
    ui.requestMessageExport('a', 'json')
    expect(request.value).toBe(1)
    notifyConnectionRemoved('a')
    expect(ui.messageExportRequest('a')).toBeNull()
    expect(request.value).toBe(0)
  })
})
