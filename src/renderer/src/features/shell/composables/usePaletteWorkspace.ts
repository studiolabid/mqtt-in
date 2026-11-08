/**
 * Command palette entries of the open connection's workspace (UX-09, A11Y-24, FP-4): views,
 * pause, edit, export, duplicate, delete, copy the broker URL or the draft as a command, and
 * keyboard focus shortcuts. Ids are stable hooks (CT-25): `pause`, `edit`, `export-json`,
 * `export-csv`, `duplicate`, `delete`, `copy-url`, `focus-publish`, `focus-messages`.
 *
 * Must be called from a component `setup` (it uses the router through the connection actions).
 */
import {
  CopyPlusIcon,
  EraserIcon,
  FileJsonIcon,
  FileSpreadsheetIcon,
  LinkIcon,
  ListPlusIcon,
  ListTreeIcon,
  MessagesSquareIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  ScrollTextIcon,
  SendIcon,
  TerminalIcon,
  TextCursorInputIcon,
  Trash2Icon
} from '@lucide/vue'
import { hostPlatform, useConnectionActions } from '@/composables'
import { useConnectionsStore, useMessagesStore, usePublishStore, useUiStore } from '@/stores'
import type { WorkspaceTab } from '@/types'
import { defaultCliShell } from '@/utils/cli-command'
import { SHORTCUTS } from '@/utils/shortcuts'
import { copyCommand, draftCommand, type PublishTool } from '../utils/cli-copy'
import type { PaletteCommand } from './palette-types'
import { focusMessageList, focusPublishTopic, refocusAfterTabSwitch } from './workspace-focus'

const DRAFT_TOOLS: ReadonlyArray<{ tool: PublishTool; id: string; label: string }> = [
  {
    tool: 'mosquitto_pub',
    id: 'copy-draft-mosquitto',
    label: 'Copy draft as mosquitto_pub command'
  },
  { tool: 'mqttx', id: 'copy-draft-mqttx', label: 'Copy draft as mqttx pub command' }
]

/** Builds the workspace entries of a connection (re-run by the palette's computed). */
export function usePaletteWorkspace(): (connectionId: string) => PaletteCommand[] {
  const ui = useUiStore()
  const messages = useMessagesStore()
  const connections = useConnectionsStore()
  const publish = usePublishStore()
  const actions = useConnectionActions()
  const shell = defaultCliShell(hostPlatform())

  function showTab(connectionId: string, tab: WorkspaceTab): void {
    ui.setWorkspaceTab(connectionId, tab)
    void refocusAfterTabSwitch(tab)
  }

  function draftCommands(connectionId: string): PaletteCommand[] {
    const profile = connections.get(connectionId)
    if (!profile) return []
    return DRAFT_TOOLS.map(({ tool, id, label }) => {
      const result = draftCommand(profile, publish.draft(connectionId), tool, shell)
      return {
        id,
        label,
        icon: TerminalIcon,
        keywords: 'cli shell terminal mosquitto mqttx publish script',
        disabled: !result.ok,
        hint: result.ok ? undefined : result.error,
        // Built again when run: templates render fresh values.
        run: () => {
          const current = connections.get(connectionId)
          return current
            ? copyCommand(draftCommand(current, publish.draft(connectionId), tool, shell))
            : undefined
        }
      }
    })
  }

  return (connectionId) => {
    const paused = messages.isPaused(connectionId)
    return [
      {
        id: 'new-subscription',
        label: 'New subscription',
        icon: ListPlusIcon,
        keys: SHORTCUTS.newSubscription.keys,
        keywords: 'subscribe topic filter',
        run: () => ui.openNewSubscription(connectionId, { topic: '' })
      },
      {
        id: 'tab-messages',
        label: 'Show messages',
        icon: MessagesSquareIcon,
        keys: SHORTCUTS.tabMessages.keys,
        keywords: 'stream list',
        run: () => showTab(connectionId, 'messages')
      },
      {
        id: 'tab-topics',
        label: 'Show topics',
        icon: ListTreeIcon,
        keys: SHORTCUTS.tabTopics.keys,
        keywords: 'tree explorer retained',
        run: () => showTab(connectionId, 'topics')
      },
      {
        id: 'tab-logs',
        label: 'Show logs',
        icon: ScrollTextIcon,
        keys: SHORTCUTS.tabLogs.keys,
        keywords: 'events errors',
        run: () => showTab(connectionId, 'logs')
      },
      {
        id: 'pause',
        label: paused ? 'Resume messages' : 'Pause messages',
        icon: paused ? PlayIcon : PauseIcon,
        keys: SHORTCUTS.togglePause.keys,
        keywords: 'pause resume freeze stop live stream',
        run: () => messages.togglePaused(connectionId)
      },
      {
        id: 'clear-messages',
        label: 'Clear messages',
        icon: EraserIcon,
        keys: SHORTCUTS.clearMessages.keys,
        keywords: 'delete empty reset',
        run: () => actions.clearMessages(connectionId)
      },
      {
        id: 'export-json',
        label: 'Export messages as JSON…',
        icon: FileJsonIcon,
        keywords: 'save download file messages',
        run: () => ui.requestMessageExport(connectionId, 'json')
      },
      {
        id: 'export-csv',
        label: 'Export messages as CSV…',
        icon: FileSpreadsheetIcon,
        keywords: 'save download file messages spreadsheet',
        run: () => ui.requestMessageExport(connectionId, 'csv')
      },
      {
        id: 'focus-publish',
        label: 'Focus publish topic',
        icon: SendIcon,
        keywords: 'publisher send message go to',
        run: () => focusPublishTopic()
      },
      {
        id: 'focus-messages',
        label: 'Focus message list',
        icon: TextCursorInputIcon,
        keywords: 'go to messages stream',
        run: () => {
          ui.setWorkspaceTab(connectionId, 'messages')
          return focusMessageList()
        }
      },
      ...draftCommands(connectionId),
      {
        id: 'edit',
        label: 'Edit connection…',
        icon: PencilIcon,
        keys: SHORTCUTS.editConnection.keys,
        keywords: 'settings broker host password change',
        run: () => ui.openEditConnection(connectionId)
      },
      {
        id: 'duplicate',
        label: 'Duplicate connection',
        icon: CopyPlusIcon,
        keywords: 'copy clone',
        run: () => actions.duplicate(connectionId)
      },
      {
        id: 'copy-url',
        label: 'Copy broker URL',
        icon: LinkIcon,
        keywords: 'address host clipboard',
        run: () => actions.copyBrokerUrl(connectionId)
      },
      {
        id: 'delete',
        label: 'Delete connection…',
        icon: Trash2Icon,
        keywords: 'remove',
        run: () => actions.remove(connectionId)
      }
    ]
  }
}
