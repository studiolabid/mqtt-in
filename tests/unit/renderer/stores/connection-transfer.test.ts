import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { createConnectionProfile } from '@shared/defaults'
import { ACTION_TOAST_DURATION } from '@/lib/toast-options'
import { exportToast, fileName, importToast } from '@/stores/connection-transfer'
import { useConnectionsStore } from '@/stores/connections'
import { importResult, settle } from '../helpers'
import { setupStores } from './setup'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  })
}))

const reason = 'port: Too big: expected number to be <=65535'

describe('connection import outcome (CT-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('toasts imported, skipped, present and certificate counts', async () => {
    const { bridge } = await setupStores()
    const imported = [
      createConnectionProfile({ name: 'a' }),
      createConnectionProfile({ name: 'b' })
    ]
    vi.mocked(bridge.api.connections.importFromFile).mockResolvedValueOnce(
      importResult({
        imported,
        skipped: [{ name: 'bad', reason }],
        duplicates: 6,
        tlsPathsCleared: 2
      })
    )
    expect(await useConnectionsStore().importFromFile()).toBe(2)
    expect(toast.success).toHaveBeenCalledWith('Imported 2 connections', {
      description: `1 skipped (${reason}) · 6 already present · 2 need their certificate files selected again`
    })
  })

  it('says so when every connection is already present', async () => {
    const { bridge } = await setupStores()
    vi.mocked(bridge.api.connections.importFromFile).mockResolvedValueOnce(
      importResult({ imported: [], duplicates: 6 })
    )
    expect(await useConnectionsStore().importFromFile()).toBe(0)
    expect(toast.info).toHaveBeenCalledWith('All 6 connections are already present', {
      description: undefined
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('words the other outcomes', () => {
    const one = createConnectionProfile()
    expect(
      importToast(importResult({ imported: [one], source: 'mqttx', tlsPathsCleared: 1 }))
    ).toEqual({
      kind: 'success',
      title: 'Imported 1 connection from MQTTX',
      description: '1 needs its certificate files selected again'
    })
    expect(importToast(importResult({ duplicates: 1 })).title).toBe(
      'This connection is already present'
    )
    expect(importToast(importResult({ skipped: [{ reason }], duplicates: 2 }))).toEqual({
      kind: 'warning',
      title: 'No connections imported',
      description: `2 already present · 1 skipped (${reason})`
    })
    const capped = Array.from({ length: 20 }, () => ({ reason }))
    expect(importToast(importResult({ imported: [one], skipped: capped })).description).toBe(
      `20+ skipped (${reason})`
    )
    expect(importToast(importResult())).toEqual({
      kind: 'info',
      title: 'The file contains no connections'
    })
  })
})

describe('connection export outcome (CT-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes the options through and names only the file in the toast', async () => {
    const { bridge, profiles } = await setupStores([
      { name: 'a', password: 'hunter2' },
      { name: 'b' }
    ])
    const path = 'C:\\Users\\me\\AppData\\Local\\Temp\\exports\\mqtey-connections.json'
    vi.mocked(bridge.api.connections.exportToFile).mockResolvedValue(path)
    const store = useConnectionsStore()

    expect(await store.exportToFile(undefined, { includeSecrets: true })).toBe(path)
    expect(bridge.api.connections.exportToFile).toHaveBeenLastCalledWith(undefined, {
      includeSecrets: true
    })
    expect(toast.success).toHaveBeenLastCalledWith('Exported 2 connections', {
      description: 'mqtey-connections.json · includes passwords in plain text',
      action: { label: 'Show in folder', onClick: expect.any(Function) },
      duration: ACTION_TOAST_DURATION
    })

    await store.exportToFile([profiles[0].id, 'unknown'])
    expect(bridge.api.connections.exportToFile).toHaveBeenLastCalledWith(
      [profiles[0].id, 'unknown'],
      undefined
    )
    const [title, options] = vi.mocked(toast.success).mock.calls.at(-1) ?? []
    expect(title).toBe('Exported 1 connection')
    expect(options).toMatchObject({
      description: 'mqtey-connections.json · passwords not included'
    })
    expect(JSON.stringify(options)).not.toContain('AppData')
  })

  it("'Show in folder' reveals the written file (and toasts when it cannot)", async () => {
    const { bridge } = await setupStores([{ name: 'a' }])
    vi.mocked(bridge.api.connections.exportToFile).mockResolvedValue('/tmp/out.json')
    await useConnectionsStore().exportToFile()
    const options = vi.mocked(toast.success).mock.calls.at(-1)?.[1] as {
      action: { onClick: () => void }
    }
    options.action.onClick()
    expect(bridge.api.app.showItemInFolder).toHaveBeenCalledWith('/tmp/out.json')

    vi.mocked(bridge.api.app.showItemInFolder).mockRejectedValueOnce(new Error('Unknown file'))
    options.action.onClick()
    await settle()
    expect(toast.error).toHaveBeenCalledWith('Could not show the file', {
      description: 'Unknown file'
    })
  })

  it('words the secrets state and the file name', () => {
    const plain = createConnectionProfile()
    const secret = createConnectionProfile({
      tls: { ...plain.tls, passphrase: 'key-pass' }
    })
    expect(exportToast('/a/b.json', [plain], false).description).toBe('b.json')
    expect(exportToast('/a/b.json', [plain, secret], false).description).toBe(
      'b.json · passwords not included'
    )
    expect(fileName('C:\\x\\y\\z.json')).toBe('z.json')
    expect(fileName('relative.json')).toBe('relative.json')
  })
})

/** A promise with its resolve function. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('one busy state per transfer (RC-22)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports an import from any entry point, and a second request joins it', async () => {
    const { bridge } = await setupStores()
    const store = useConnectionsStore()
    const pending = deferred<ReturnType<typeof importResult>>()
    vi.mocked(bridge.api.connections.importFromFile).mockReturnValueOnce(pending.promise)
    expect(store.importing).toBe(false)

    const first = store.importFromFile() // e.g. the sidebar
    expect(store.importing).toBe(true)
    // e.g. the palette while the file dialog is open: no second dialog, the same outcome.
    const second = store.importFromFile()
    expect(bridge.api.connections.importFromFile).toHaveBeenCalledTimes(1)

    pending.resolve(importResult({ imported: [createConnectionProfile({ name: 'n' })] }))
    expect(await first).toBe(1)
    expect(await second).toBe(1)
    expect(store.importing).toBe(false)
    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('clears the import state after a failure', async () => {
    const { bridge } = await setupStores()
    const store = useConnectionsStore()
    vi.mocked(bridge.api.connections.importFromFile).mockRejectedValueOnce(new Error('bad file'))
    const run = store.importFromFile()
    expect(store.importing).toBe(true)
    expect(await run).toBe(0)
    expect(store.importing).toBe(false)
  })

  it('runs one export at a time', async () => {
    const { bridge, profiles } = await setupStores([{ name: 'a' }])
    const store = useConnectionsStore()
    const pending = deferred<string | null>()
    vi.mocked(bridge.api.connections.exportToFile).mockReturnValueOnce(pending.promise)

    const first = store.exportToFile()
    expect(store.exporting).toBe(true)
    expect(await store.exportToFile([profiles[0].id])).toBeNull()
    expect(bridge.api.connections.exportToFile).toHaveBeenCalledTimes(1)

    pending.resolve('/tmp/all.json')
    expect(await first).toBe('/tmp/all.json')
    expect(store.exporting).toBe(false)
    await settle()
    vi.mocked(bridge.api.connections.exportToFile).mockResolvedValueOnce('/tmp/one.json')
    expect(await store.exportToFile([profiles[0].id])).toBe('/tmp/one.json')
  })
})
