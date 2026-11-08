/**
 * "Copy as command ▸ mosquitto_sub / mqttx sub" of the subscription row menu (FP-4, FA-14): the
 * subscription as a CLI command line (`@/utils/cli-command`), never with the password inlined.
 * An entry the generator cannot express (e.g. mosquitto over WebSockets) is disabled and says why.
 * The copy toast names the password variable and a shell caveat (`copyCommand`, `copiedToast`).
 */
import type { ConnectionProfile, Subscription } from '@shared/models'
import {
  subscribeCommand,
  type CliResult,
  type CliShell,
  type SubscribeCommandInput
} from '@/utils/cli-command'

export type SubscribeTool = 'mosquitto_sub' | 'mqttx'

export interface CommandMenuItem {
  tool: SubscribeTool
  label: string
  result: CliResult
  disabled: boolean
  /** Why the entry is disabled (its tooltip). */
  reason?: string
}

const TOOLS: ReadonlyArray<{ tool: SubscribeTool; label: string }> = [
  { tool: 'mosquitto_sub', label: 'mosquitto_sub' },
  { tool: 'mqttx', label: 'mqttx sub' }
]

type Generate = (input: SubscribeCommandInput, tool: SubscribeTool, shell: CliShell) => CliResult

/** The entries of the "Copy as command" submenu of a subscription. */
export function subscriptionCommandItems(
  profile: ConnectionProfile,
  subscription: Subscription,
  shell: CliShell,
  generate: Generate = subscribeCommand
): CommandMenuItem[] {
  return TOOLS.map(({ tool, label }) => {
    const result = generate({ profile, subscription }, tool, shell)
    return result.ok
      ? { tool, label, result, disabled: false }
      : { tool, label, result, disabled: true, reason: result.error }
  })
}

/** Copies a generated command with its toast (shared by every "Copy as command" entry point). */
export { copyCommand } from '@/composables/useCopy'
