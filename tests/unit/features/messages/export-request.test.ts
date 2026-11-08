/**
 * CT-17 / UX-20: message exports requested elsewhere (the command palette) run once per
 * request, and a written export toasts its file name with "Show in folder".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, type EffectScope } from 'vue'
import { toast } from 'vue-sonner'
import {
  exportedToast,
  useExportRequests,
  useMessageExport
} from '@/features/messages/composables/useMessageExport'
import { ACTION_TOAST_DURATION } from '@/lib/toast-options'
import { useUiStore } from '@/stores/ui'
import { message, settle } from '../../renderer/helpers'
import { setupStores, type StoreSetup } from '../../renderer/stores/setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
}))

let setup: StoreSetup
let scope: EffectScope

beforeEach(async () => {
  vi.clearAllMocks()
  setup = await setupStores([{ name: 'Lab' }, { name: 'Other' }])
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
})

describe('useExportRequests', () => {
  it('runs one export per request, in the requested format', async () => {
    const [lab] = setup.profiles
    const run = vi.fn()
    scope.run(() => useExportRequests(lab.id, run))
    const ui = useUiStore()
    ui.requestMessageExport(lab.id, 'csv')
    await nextTick()
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenLastCalledWith('csv')
    ui.requestMessageExport(lab.id, 'json')
    await nextTick()
    expect(run).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenLastCalledWith('json')
  })

  it('does not replay an earlier request nor react to another connection', async () => {
    const [lab, other] = setup.profiles
    const ui = useUiStore()
    ui.requestMessageExport(lab.id, 'json')
    const run = vi.fn()
    scope.run(() => useExportRequests(lab.id, run))
    await nextTick()
    ui.requestMessageExport(other.id, 'csv')
    await nextTick()
    expect(run).not.toHaveBeenCalled()
  })
})

describe('the export toast', () => {
  it('names the file only and offers Show in folder', () => {
    exportedToast('C:\\Users\\me\\Downloads\\lab-messages.csv', 25)
    expect(toast.success).toHaveBeenCalledTimes(1)
    const [title, options] = vi.mocked(toast.success).mock.calls[0]
    expect(title).toBe('Exported 25 messages')
    expect(options).toMatchObject({
      description: 'lab-messages.csv',
      duration: ACTION_TOAST_DURATION,
      action: { label: 'Show in folder' }
    })
    const action = (options as { action: { onClick: () => void } }).action
    action.onClick()
    expect(setup.bridge.api.app.showItemInFolder).toHaveBeenCalledWith(
      'C:\\Users\\me\\Downloads\\lab-messages.csv'
    )
  })

  it('is shown after a written export', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 0))
    const [lab] = setup.profiles
    vi.mocked(setup.bridge.api.dialog.saveFile).mockResolvedValue('/home/me/lab.json')
    const exporter = scope.run(() => useMessageExport(lab.id))
    await exporter?.exportMessages('json', [message({ connectionId: lab.id })])
    await settle()
    expect(setup.bridge.api.dialog.saveFile).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith(
      'Exported 1 message',
      expect.objectContaining({ description: 'lab.json' })
    )
  })

  it('says so when there is nothing to export', async () => {
    const [lab] = setup.profiles
    const exporter = scope.run(() => useMessageExport(lab.id))
    await exporter?.exportMessages('csv', [])
    expect(setup.bridge.api.dialog.saveFile).not.toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalledWith('There are no messages to export')
  })
})
