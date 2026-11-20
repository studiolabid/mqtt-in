/**
 * `update.*` — self-update state, "Check for updates" and "Restart & update".
 */
import { IPC, IPC_EVENTS } from '@shared/ipc'
import type { UpdateService } from '../services/updater/update-service'
import { broadcast } from './broadcast'
import type { RegisterHandler } from './handle'

export function registerUpdateIpc(register: RegisterHandler, updates: UpdateService): void {
  register(IPC.updateGetState, () => updates.getState())
  register(IPC.updateCheck, () => updates.check())
  register(IPC.updateInstall, () => updates.install())
}

/** Sends an update state to every window (`IPC_EVENTS.update`). */
export function broadcastUpdateState(state: unknown): void {
  broadcast(IPC_EVENTS.update, state)
}
