/**
 * `mqtt.*` — live sessions (connect, subscribe, publish, repeat jobs).
 */
import { IPC } from '@shared/ipc'
import type { MqttManager } from '../services/mqtt/mqtt-manager'
import type { RegisterHandler } from './handle'
import { parseId, parsePublishRequest, parseRepeatOptions, parseSubscription } from './validate'

/** Registers `mqtt.*` (connect, subscribe, publish, repeat jobs, sessions). */
export function registerMqttIpc(register: RegisterHandler, manager: MqttManager): void {
  const connectionId = (raw: unknown): string => parseId(raw, 'connection id')

  register(IPC.mqttConnect, (_ctx, id) => manager.connect(connectionId(id)))

  register(IPC.mqttDisconnect, (_ctx, id) => manager.disconnect(connectionId(id)))

  register(IPC.mqttSubscribe, (_ctx, id, subscription) =>
    manager.subscribe(connectionId(id), parseSubscription(subscription))
  )

  register(IPC.mqttUnsubscribe, (_ctx, id, subscription) =>
    manager.unsubscribe(connectionId(id), parseSubscription(subscription))
  )

  register(IPC.mqttPublish, (_ctx, id, request) =>
    manager.publish(connectionId(id), parsePublishRequest(request))
  )

  register(IPC.mqttRepeatStart, (_ctx, id, options) =>
    manager.startRepeat(connectionId(id), parseRepeatOptions(options))
  )

  register(IPC.mqttRepeatStop, (_ctx, jobId) => {
    manager.stopRepeat(parseId(jobId, 'job id'))
  })

  register(IPC.mqttSessions, () => manager.getSessions())
}
