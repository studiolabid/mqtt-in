/**
 * Test helpers: an in-process aedes broker (MQTT 3.1.1), a recording event sink and polling.
 */
import { createServer, type AddressInfo, type Server } from 'node:net'
import { Aedes, type AedesOptions } from 'aedes'
import type {
  LogEntry,
  MqttMessage,
  RepeatJobEvent,
  StatusEvent,
  SubscriptionEvent
} from '@shared/models'
import type { EventSink } from '../../../../src/main/services/mqtt/types'

export interface TestBroker {
  broker: Aedes
  port: number
  close(): Promise<void>
}

export async function startBroker(options: AedesOptions = {}): Promise<TestBroker> {
  const broker = await Aedes.createBroker(options)
  const server: Server = createServer(broker.handle)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    broker,
    port,
    close: async () => {
      await new Promise<void>((resolve) => broker.close(() => resolve()))
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

/** A TCP port with nothing listening on it. */
export async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

export interface Recorder {
  sink: EventSink
  status: StatusEvent[]
  messages: MqttMessage[]
  subscriptions: SubscriptionEvent[]
  logs: LogEntry[]
  repeat: RepeatJobEvent[]
}

export function createRecorder(): Recorder {
  const recorder: Omit<Recorder, 'sink'> = {
    status: [],
    messages: [],
    subscriptions: [],
    logs: [],
    repeat: []
  }
  return {
    ...recorder,
    sink: {
      status: (event) => recorder.status.push(event),
      messages: (batch) => recorder.messages.push(...batch),
      subscription: (event) => recorder.subscriptions.push(event),
      log: (entry) => recorder.logs.push(entry),
      repeat: (event) => recorder.repeat.push(event)
    }
  }
}

/** Polls `probe` until it returns a truthy value (or throws after `timeoutMs`). */
export async function waitFor<T>(
  probe: () => T | undefined | null | false,
  timeoutMs = 4000,
  what = 'condition'
): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = probe()
    if (value) return value
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`)
    await sleep(10)
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
