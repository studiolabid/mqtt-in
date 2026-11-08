/**
 * Entries of the command palette, built reactively from the stores. Labels that depend on
 * state (theme, sidebar, session, pause) change with it; the palette keys items by label so the
 * command list re-indexes their search text.
 *
 * While a connection's workspace is open, its commands come first (`usePaletteWorkspace`); the
 * global ones (`new-connection`, `import`, `export`, `disconnect-all`, `theme`, `sidebar`,
 * `settings`) are always listed.
 */
import { computed, type ComputedRef } from 'vue'
import {
  FileDownIcon,
  FileUpIcon,
  InfoIcon,
  KeyboardIcon,
  MoonIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlugIcon,
  PlusIcon,
  RotateCwIcon,
  SettingsIcon,
  SunIcon,
  UnplugIcon
} from '@lucide/vue'
import type { ConnectionProfile, ConnectionStatus } from '@shared/models'
import { brokerUrl } from '@shared/defaults'
import { useNavigation } from '@/composables'
import { useConnectionsStore, useSessionsStore, useSettingsStore, useUiStore } from '@/stores'
import { isActiveStatus } from '@/utils/connection'
import { BROKER_PRESETS } from '@/utils/presets'
import { SHORTCUTS } from '@/utils/shortcuts'
import { presetIcon } from '../utils/presets'
import type { PaletteCommand, PaletteConnection } from './palette-types'
import { usePaletteWorkspace } from './usePaletteWorkspace'
import { useShortcutsDialog } from './useShortcutsDialog'
import { useSidebarLayout } from './useSidebarLayout'

export type { PaletteCommand, PaletteConnection } from './palette-types'

export interface PaletteCommands {
  connections: ComputedRef<PaletteConnection[]>
  actions: ComputedRef<PaletteCommand[]>
  presets: PaletteCommand[]
  help: PaletteCommand[]
  openConnection(id: string): Promise<void>
}

export function usePaletteCommands(): PaletteCommands {
  const ui = useUiStore()
  const settings = useSettingsStore()
  const connections = useConnectionsStore()
  const sessions = useSessionsStore()
  const nav = useNavigation()
  const sidebar = useSidebarLayout()
  const shortcuts = useShortcutsDialog()
  const workspaceCommands = usePaletteWorkspace()

  function sessionCommand(profile: ConnectionProfile, status: ConnectionStatus): PaletteCommand {
    const base = { id: `session:${profile.id}`, run: () => sessions.toggle(profile.id) }
    if (status === 'disconnecting') {
      return { ...base, label: `Disconnecting ${profile.name}…`, icon: UnplugIcon, disabled: true }
    }
    if (isActiveStatus(status)) {
      return { ...base, label: `Disconnect ${profile.name}`, icon: UnplugIcon, keywords: 'stop' }
    }
    if (status === 'error') {
      return { ...base, label: `Retry ${profile.name}`, icon: RotateCwIcon, keywords: 'connect' }
    }
    return { ...base, label: `Connect ${profile.name}`, icon: PlugIcon, keywords: 'start' }
  }

  const connectionEntries = computed<PaletteConnection[]>(() =>
    connections.profiles.map((profile) => {
      const status = sessions.statusOf(profile.id)
      return {
        profile,
        url: brokerUrl(profile),
        status,
        current: nav.currentConnectionId.value === profile.id,
        session: sessionCommand(profile, status)
      }
    })
  )

  /** Saved connections whose session is connected, connecting or reconnecting. */
  const activeIds = computed(() =>
    connections.profiles.map((profile) => profile.id).filter((id) => sessions.isActive(id))
  )

  const actions = computed<PaletteCommand[]>(() => {
    const connectionId = nav.currentConnectionId.value
    const dark = settings.isDark
    const collapsed = sidebar.collapsed.value
    const active = activeIds.value
    return [
      ...(connectionId && connections.get(connectionId) ? workspaceCommands(connectionId) : []),
      {
        id: 'new-connection',
        label: 'New connection',
        icon: PlusIcon,
        keys: SHORTCUTS.newConnection.keys,
        keywords: 'add create broker',
        run: () => ui.openNewConnection()
      },
      {
        id: 'import',
        label: 'Import connections…',
        icon: FileUpIcon,
        keywords: 'file json mqttx',
        // One busy state for every entry point (RC-22): the sidebar and welcome spin meanwhile.
        disabled: connections.importing,
        run: () => connections.importFromFile()
      },
      {
        id: 'export',
        label: 'Export all connections…',
        icon: FileDownIcon,
        keywords: 'file json backup',
        disabled: connections.profiles.length === 0 || connections.exporting,
        // Without passwords: only Settings > Data offers to include them.
        run: () => connections.exportToFile()
      },
      {
        id: 'disconnect-all',
        label: 'Disconnect all',
        icon: UnplugIcon,
        keywords: 'stop close every session',
        disabled: active.length === 0,
        run: () => Promise.all(active.map((id) => sessions.disconnect(id)))
      },
      {
        id: 'theme',
        label: dark ? 'Switch to light theme' : 'Switch to dark theme',
        icon: dark ? SunIcon : MoonIcon,
        keys: SHORTCUTS.toggleTheme.keys,
        keywords: 'toggle appearance mode dark light',
        run: () => settings.toggleTheme()
      },
      {
        id: 'sidebar',
        label: collapsed ? 'Show sidebar' : 'Hide sidebar',
        icon: collapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon,
        keys: SHORTCUTS.toggleSidebar.keys,
        keywords: 'toggle connections panel',
        run: () => sidebar.toggle()
      },
      {
        id: 'settings',
        label: 'Settings',
        icon: SettingsIcon,
        keys: SHORTCUTS.settings.keys,
        keywords: 'preferences options accent',
        run: () => nav.openSettings()
      }
    ]
  })

  const presets: PaletteCommand[] = BROKER_PRESETS.map((preset) => ({
    id: `preset:${preset.id}`,
    label: preset.title,
    icon: presetIcon(preset),
    hint: preset.address,
    keywords: `${preset.description} public broker new connection`,
    run: () => ui.openNewConnection(preset.profile)
  }))

  const help: PaletteCommand[] = [
    {
      id: 'shortcuts',
      label: 'Keyboard shortcuts',
      icon: KeyboardIcon,
      keywords: 'hotkeys keys cheat sheet help',
      run: shortcuts.show
    },
    {
      id: 'about',
      label: 'About mqtt-in',
      icon: InfoIcon,
      keywords: 'version help',
      run: () => nav.openSettings('about')
    }
  ]

  return {
    connections: connectionEntries,
    actions,
    presets,
    help,
    openConnection: (id) => nav.openConnection(id)
  }
}
