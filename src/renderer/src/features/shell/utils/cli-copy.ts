/**
 * "Copy draft as … command" (FP-4, FA-14): the publish draft of a connection as a mosquitto_pub
 * or MQTTX command line (`@/utils/cli-command`), copied with a toast (`copyCommand`). The password
 * is never part of the command: the toast says which environment variable to set, and a shell
 * caveat such as Windows PowerShell 5.1 dropping the quotes of a JSON payload.
 */
import type { ConnectionProfile } from '@shared/models'
import type { PublishDraft } from '@/types'
import { publishCommand, type CliResult, type CliShell } from '@/utils/cli-command'
import { preparePublish } from '@/utils/publish'

export type PublishTool = 'mosquitto_pub' | 'mqttx'

/**
 * The command line that publishes `draft` the way the publisher would now (templates rendered,
 * payload encoded, MQTT 5 properties on v5), or why it cannot be expressed.
 */
export function draftCommand(
  profile: ConnectionProfile,
  draft: PublishDraft,
  tool: PublishTool,
  shell: CliShell
): CliResult {
  const prepared = preparePublish(draft, { protocolVersion: profile.protocolVersion })
  if (!prepared.ok) return { ok: false, error: prepared.error }
  return publishCommand({ profile, ...prepared.request }, tool, shell)
}

/** Copies a generated command with its toast (shared by every "Copy as command" entry point). */
export { copyCommand } from '@/composables/useCopy'
