/**
 * Registers every IPC handler of the `MqttInApi` contract (`src/shared/ipc.ts`).
 */
import type { MqttManager } from '../services/mqtt/mqtt-manager'
import type { Storage } from '../services/storage'
import { registerAppIpc } from './app'
import { forwardStorageNotices } from './broadcast'
import { registerConnectionsIpc } from './connections'
import { registerDialogIpc } from './dialog'
import { createRegistrar, createSenderGuard } from './handle'
import { registerMqttIpc } from './mqtt'
import { registerSettingsIpc } from './settings'
import { registerStorageIpc } from './storage'
import { registerWindowIpc } from './window'

export interface IpcDeps {
  storage: Storage
  manager: MqttManager
  /** Vite dev server URL (development only); its frames are trusted IPC senders. */
  devServerUrl?: string
}

/**
 * Registers every `IPC.*` handler (each input validated, senders verified) and forwards later
 * storage notices to the windows. Call it once per process.
 */
export function registerIpc(deps: IpcDeps): void {
  const register = createRegistrar(createSenderGuard(deps.devServerUrl))
  registerConnectionsIpc(register, deps.storage.connections, deps.manager)
  registerSettingsIpc(register, deps.storage.settings)
  registerStorageIpc(register, deps.storage.kv)
  registerMqttIpc(register, deps.manager)
  registerDialogIpc(register)
  registerAppIpc(register, { notices: deps.storage.notices })
  registerWindowIpc(register)
  forwardStorageNotices(deps.storage.notices)
}

export { createWindowEventSink } from './broadcast'
