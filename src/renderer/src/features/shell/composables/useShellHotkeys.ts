/**
 * Global shortcuts owned by the shell (registered once by `AppShell`). The command palette
 * registers its own toggle; the panels own search, clear messages and publish.
 * Every shortcut pauses while a dialog of any feature is open.
 *
 * Workspace shortcuts act on the open connection: new subscription, edit connection, pause /
 * resume the message list and the view tabs. Switching views moves keyboard focus into the shown
 * view when it was in the hidden one (or nowhere).
 */
import { useHotkey, useNavigation, type HotkeyOptions } from '@/composables'
import { useMessagesStore, useSettingsStore, useUiStore } from '@/stores'
import type { WorkspaceTab } from '@/types'
import { SHORTCUTS } from '@/utils/shortcuts'
import { useSidebarLayout } from './useSidebarLayout'
import { refocusAfterTabSwitch } from './workspace-focus'

export function useShellHotkeys(): void {
  const ui = useUiStore()
  const messages = useMessagesStore()
  const settings = useSettingsStore()
  const nav = useNavigation()
  const sidebar = useSidebarLayout()

  const global: HotkeyOptions = { allowInInputs: true, ignoreInDialogs: true }
  const workspace: HotkeyOptions = {
    ...global,
    enabled: () => nav.currentConnectionId.value !== null
  }
  const inWorkspace =
    (action: (connectionId: string) => void): (() => void) =>
    () => {
      const id = nav.currentConnectionId.value
      if (id) action(id)
    }

  useHotkey(SHORTCUTS.newConnection.combo, () => ui.openNewConnection(), global)
  useHotkey(SHORTCUTS.settings.combo, () => void nav.openSettings(), global)
  useHotkey(SHORTCUTS.toggleSidebar.combo, sidebar.toggle, global)
  // Not inside inputs: CodeMirror uses Mod-Shift-L (select all matches).
  useHotkey(SHORTCUTS.toggleTheme.combo, () => void settings.toggleTheme(), {
    ignoreInDialogs: true
  })
  useHotkey(
    SHORTCUTS.newSubscription.combo,
    inWorkspace((id) => ui.openNewSubscription(id, { topic: '' })),
    workspace
  )
  useHotkey(
    SHORTCUTS.editConnection.combo,
    inWorkspace((id) => ui.openEditConnection(id)),
    workspace
  )
  useHotkey(
    SHORTCUTS.togglePause.combo,
    inWorkspace((id) => messages.togglePaused(id)),
    workspace
  )

  const tabs: ReadonlyArray<readonly [string, WorkspaceTab]> = [
    [SHORTCUTS.tabMessages.combo, 'messages'],
    [SHORTCUTS.tabTopics.combo, 'topics'],
    [SHORTCUTS.tabLogs.combo, 'logs']
  ]
  for (const [combo, tab] of tabs) {
    useHotkey(
      combo,
      inWorkspace((id) => {
        ui.setWorkspaceTab(id, tab)
        void refocusAfterTabSwitch(tab)
      }),
      workspace
    )
  }
}
