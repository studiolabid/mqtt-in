import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn()
  })
}))

/** The route the composables see (a plain object: each test builds its own commands). */
const nav = vi.hoisted(() => ({
  route: { name: 'welcome' as string, params: {} as Record<string, string>, query: {} },
  push: vi.fn(async () => undefined)
}))

vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => nav.route,
  useRouter: () => ({ push: nav.push, back: vi.fn() })
}))

import { toast } from 'vue-sonner'
import { createConnectionProfile } from '@shared/defaults'
import { usePaletteCommands } from '@/features/shell/composables/usePaletteCommands'
import { copyCommand, draftCommand } from '@/features/shell/utils/cli-copy'
import { useConnectionsStore, useMessagesStore, useSessionsStore, useUiStore } from '@/stores'
import { createPublishDraft } from '@/utils/publish'
import { setupStores } from '../../renderer/stores/setup'

const WORKSPACE_IDS = [
  'pause',
  'edit',
  'export-json',
  'export-csv',
  'duplicate',
  'delete',
  'copy-url',
  'focus-publish',
  'focus-messages'
]
const GLOBAL_IDS = [
  'new-connection',
  'import',
  'export',
  'disconnect-all',
  'theme',
  'sidebar',
  'settings'
]

function openWorkspace(id: string): void {
  nav.route = { name: 'connection', params: { id }, query: {} }
}

function ids(): string[] {
  return usePaletteCommands().actions.value.map((command) => command.id)
}

function command(id: string): ReturnType<typeof usePaletteCommands>['actions']['value'][number] {
  const found = usePaletteCommands().actions.value.find((entry) => entry.id === id)
  if (!found) throw new Error(`no palette command ${id}`)
  return found
}

describe('palette commands (UX-09, A11Y-24)', () => {
  beforeEach(() => {
    nav.route = { name: 'welcome', params: {}, query: {} }
  })

  it('lists the workspace commands while a connection is open', async () => {
    const { profiles } = await setupStores([{ name: 'A' }])
    openWorkspace(profiles[0].id)
    const list = ids()
    for (const id of [...WORKSPACE_IDS, ...GLOBAL_IDS]) expect(list).toContain(id)
    // Workspace entries first, then the global ones.
    expect(list.indexOf('pause')).toBeLessThan(list.indexOf('new-connection'))
  })

  it('lists only the global commands without an open connection', async () => {
    await setupStores([{ name: 'A' }])
    const list = ids()
    expect(list).toEqual(expect.arrayContaining(GLOBAL_IDS))
    for (const id of WORKSPACE_IDS) expect(list).not.toContain(id)
    expect(list).not.toContain('new-subscription')
  })

  it('ignores a workspace route whose connection no longer exists', async () => {
    await setupStores([{ name: 'A' }])
    openWorkspace('deleted')
    expect(ids()).not.toContain('pause')
  })

  it('pauses and resumes the message list, with a matching label and shortcut', async () => {
    const { profiles } = await setupStores([{ name: 'A' }])
    const id = profiles[0].id
    openWorkspace(id)
    const pause = command('pause')
    expect(pause.label).toBe('Pause messages')
    expect(pause.keys).toEqual(['Mod', 'Shift', 'P'])
    pause.run()
    expect(useMessagesStore().isPaused(id)).toBe(true)
    expect(command('pause').label).toBe('Resume messages')
  })

  it('opens the connection editor (Mod+E) and asks the messages panel to export', async () => {
    const { profiles } = await setupStores([{ name: 'A' }])
    const id = profiles[0].id
    openWorkspace(id)
    const ui = useUiStore()
    const edit = command('edit')
    expect(edit.keys).toEqual(['Mod', 'E'])
    edit.run()
    expect(ui.connectionDialog).toMatchObject({ open: true, editingId: id })
    command('export-csv').run()
    expect(ui.messageExportRequest(id)).toEqual({ seq: 1, format: 'csv' })
    command('export-json').run()
    expect(ui.messageExportRequest(id)).toEqual({ seq: 2, format: 'json' })
  })

  it('disconnects every active session', async () => {
    const { bridge, profiles } = await setupStores([{ name: 'A' }, { name: 'B' }])
    expect(command('disconnect-all').disabled).toBe(true)
    const sessions = useSessionsStore()
    for (const profile of profiles) {
      sessions.handleStatus({ connectionId: profile.id, status: 'connected', timestamp: 1 })
    }
    const all = command('disconnect-all')
    expect(all.disabled).toBe(false)
    await all.run()
    expect(bridge.api.mqtt.disconnect).toHaveBeenCalledTimes(2)
  })

  it('disables import and export while one runs, from any entry point (RC-22)', async () => {
    const { bridge } = await setupStores([{ name: 'A' }])
    const connections = useConnectionsStore()
    let finishImport: (value: null) => void = () => undefined
    vi.mocked(bridge.api.connections.importFromFile).mockImplementationOnce(
      () => new Promise((resolve) => (finishImport = resolve))
    )
    const importing = connections.importFromFile()
    expect(command('import').disabled).toBe(true)
    finishImport(null)
    await importing
    expect(command('import').disabled).toBe(false)

    let finishExport: (value: string | null) => void = () => undefined
    vi.mocked(bridge.api.connections.exportToFile).mockImplementationOnce(
      () => new Promise((resolve) => (finishExport = resolve))
    )
    const exporting = connections.exportToFile()
    expect(command('export').disabled).toBe(true)
    finishExport(null)
    await exporting
    expect(command('export').disabled).toBe(false)
  })

  it('copies the draft with the Windows PowerShell 5.1 caveat for a JSON payload (CT-15)', async () => {
    const profile = createConnectionProfile({ host: 'broker.local', password: 'secret' })
    const draft = createPublishDraft({ topic: 'a/b', payload: '{"on":true}', format: 'json' })
    const result = draftCommand(profile, draft, 'mosquitto_pub', 'powershell')
    expect(result.ok && result.command).not.toContain('secret')
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    try {
      await expect(copyCommand(result)).resolves.toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('Command copied', {
      description: expect.stringMatching(/MQTT_PASSWORD.*Windows PowerShell 5\.1/)
    })
  })

  it('offers the draft as a command, disabled with the reason when it cannot be one', async () => {
    const { profiles } = await setupStores([{ name: 'WS', protocol: 'ws', port: 8083 }])
    openWorkspace(profiles[0].id)
    const mosquitto = command('copy-draft-mosquitto')
    expect(mosquitto.disabled).toBe(true)
    expect(mosquitto.hint).toMatch(/WebSockets/)
    expect(command('copy-draft-mqttx').disabled).toBe(false)
  })
})
