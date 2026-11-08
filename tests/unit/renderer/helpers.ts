/**
 * Helpers shared by the renderer test suites: message factories and a fake preload bridge.
 */
import { vi } from 'vitest'
import type { MqteyApi } from '@shared/ipc'
import type {
  BrokerInfo,
  ConnectionProfile,
  ImportConnectionsResult,
  LogEntry,
  MqttMessage,
  RepeatJobEvent,
  SessionSnapshot,
  StatusEvent,
  StorageNotice,
  Subscription,
  SubscriptionEvent
} from '@shared/models'
import { DEFAULT_SETTINGS } from '@shared/defaults'

const encoder = new TextEncoder()

/** UTF-8 bytes of a string. */
export function utf8(text: string): Uint8Array {
  return encoder.encode(text)
}

let nextMessageId = 1

/** A message with sensible defaults and a monotonic id. */
export function message(overrides: Partial<MqttMessage> = {}): MqttMessage {
  return {
    id: nextMessageId++,
    connectionId: 'c1',
    direction: 'in',
    topic: 'home/sensor/1',
    payload: utf8('{"t":21.5}'),
    qos: 0,
    retain: false,
    dup: false,
    timestamp: 1_700_000_000_000,
    ...overrides
  }
}

/** `count` messages created with `message()`. */
export function messages(count: number, overrides: Partial<MqttMessage> = {}): MqttMessage[] {
  return Array.from({ length: count }, () => message(overrides))
}

/** An `importFromFile` outcome: nothing imported, skipped or present unless overridden. */
export function importResult(
  overrides: Partial<ImportConnectionsResult> = {}
): ImportConnectionsResult {
  return {
    imported: [],
    skipped: [],
    duplicates: 0,
    tlsPathsCleared: 0,
    source: 'mqtey',
    ...overrides
  }
}

/**
 * What an MQTT 5 broker announced in its CONNACK (an EMQX-like set unless overridden). No
 * `maximumQoS`: a broker announces it only to limit QoS to 0 or 1.
 */
export function brokerInfo(overrides: Partial<BrokerInfo> = {}): BrokerInfo {
  return {
    protocolVersion: 5,
    sessionPresent: false,
    retainAvailable: true,
    wildcardSubscriptionAvailable: true,
    sharedSubscriptionAvailable: true,
    subscriptionIdentifiersAvailable: true,
    receiveMaximum: 32,
    maximumPacketSize: 1_048_576,
    topicAliasMaximum: 65_535,
    ...overrides
  }
}

/**
 * A connected session snapshot (`getSessions()` after a renderer reload) with no subscriptions
 * or repeat jobs unless overridden.
 */
export function sessionSnapshot(
  overrides: Partial<SessionSnapshot> & Pick<SessionSnapshot, 'connectionId'>
): SessionSnapshot {
  return {
    status: 'connected',
    connectedAt: 1_700_000_000_000,
    subscriptions: [],
    repeatJobs: [],
    ...overrides
  }
}

/** A storage notice (`corrupt` connections.json unless overridden). */
export function storageNotice(overrides: Partial<StorageNotice> = {}): StorageNotice {
  return {
    kind: 'corrupt',
    file: 'connections.json',
    message: 'connections.json was damaged; it was moved aside and the app started empty.',
    timestamp: 1_700_000_000_000,
    ...overrides
  }
}

/** Listeners registered through the fake bridge's `on*` methods. */
export interface FakeListeners {
  status: Array<(event: StatusEvent) => void>
  messages: Array<(batch: MqttMessage[]) => void>
  subscription: Array<(event: SubscriptionEvent) => void>
  log: Array<(entry: LogEntry) => void>
  repeat: Array<(event: RepeatJobEvent) => void>
  storageNotice: Array<(notice: StorageNotice) => void>
}

export interface FakeBridge {
  api: MqteyApi
  listeners: FakeListeners
  /** Profiles held by the fake main process. */
  stored: ConnectionProfile[]
  /** Values held by the fake key/value storage. */
  storage: Map<string, unknown>
  /** What `app.getStorageNotices()` returns; call `listeners.storageNotice` for live ones. */
  notices: StorageNotice[]
}

function track<T>(list: T[], listener: T): () => void {
  list.push(listener)
  return () => {
    const index = list.indexOf(listener)
    if (index !== -1) list.splice(index, 1)
  }
}

/** A fake `window.mqtey` whose methods are `vi.fn()`s with realistic default behavior. */
export function createFakeBridge(): FakeBridge {
  const listeners: FakeListeners = {
    status: [],
    messages: [],
    subscription: [],
    log: [],
    repeat: [],
    storageNotice: []
  }
  const stored: ConnectionProfile[] = []
  const storage = new Map<string, unknown>()
  const notices: StorageNotice[] = []
  let settings = { ...DEFAULT_SETTINGS }
  let jobs = 0

  const api: MqteyApi = {
    connections: {
      list: vi.fn(async () => structuredClone(stored)),
      save: vi.fn(async (profile: ConnectionProfile) => {
        const saved = { ...structuredClone(profile), updatedAt: Date.now() }
        const index = stored.findIndex((p) => p.id === profile.id)
        if (index === -1) stored.push(saved)
        else stored[index] = saved
        return structuredClone(saved)
      }),
      remove: vi.fn(async (id: string) => {
        const index = stored.findIndex((p) => p.id === id)
        if (index !== -1) stored.splice(index, 1)
      }),
      reorder: vi.fn(async () => undefined),
      // Cancelled dialogs by default; mock a result with `importResult()`.
      importFromFile: vi.fn(async (): Promise<ImportConnectionsResult | null> => null),
      exportToFile: vi.fn(async (): Promise<string | null> => null)
    },
    settings: {
      get: vi.fn(async () => ({ ...settings })),
      update: vi.fn(async (patch) => {
        settings = { ...settings, ...patch }
        return { ...settings }
      })
    },
    storage: {
      // vi.fn() drops the generic signature, so restore it for the MqteyApi type.
      get: vi.fn(async (key: string) => storage.get(key)) as MqteyApi['storage']['get'],
      set: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, structuredClone(value))
      })
    },
    mqtt: {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      subscribe: vi.fn(async (connectionId: string, sub: Subscription) => ({
        connectionId,
        subscriptionId: sub.id,
        topic: sub.topic,
        state: 'subscribed' as const,
        grantedQos: sub.qos,
        timestamp: Date.now()
      })),
      unsubscribe: vi.fn(async (connectionId: string, sub: Subscription) => ({
        connectionId,
        subscriptionId: sub.id,
        topic: sub.topic,
        state: 'idle' as const,
        timestamp: Date.now()
      })),
      publish: vi.fn(async () => undefined),
      startRepeat: vi.fn(async () => `job-${++jobs}`),
      stopRepeat: vi.fn(async () => undefined),
      getSessions: vi.fn(async () => []),
      onStatus: (listener) => track(listeners.status, listener),
      onMessages: (listener) => track(listeners.messages, listener),
      onSubscription: (listener) => track(listeners.subscription, listener),
      onLog: (listener) => track(listeners.log, listener),
      onRepeat: (listener) => track(listeners.repeat, listener)
    },
    dialog: {
      pickFile: vi.fn(async () => null),
      openFile: vi.fn(async () => null),
      saveFile: vi.fn(async () => null)
    },
    app: {
      platform: 'win32',
      getInfo: vi.fn(async () => {
        throw new Error('not implemented in the fake bridge')
      }),
      openExternal: vi.fn(async () => undefined),
      getStorageNotices: vi.fn(async () => structuredClone(notices)),
      onStorageNotice: (listener) => track(listeners.storageNotice, listener),
      showItemInFolder: vi.fn(async () => undefined)
    },
    window: {
      setTheme: vi.fn(async () => undefined)
    }
  }
  return { api, listeners, stored, storage, notices }
}

/** Installs a fresh fake bridge as `window.mqtey` and returns it. */
export function installFakeBridge(): FakeBridge {
  const bridge = createFakeBridge()
  vi.stubGlobal('window', { mqtey: bridge.api })
  return bridge
}

/** Resolves pending promise callbacks (several microtask turns). */
export async function settle(turns = 30): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}
