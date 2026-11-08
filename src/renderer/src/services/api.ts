/**
 * The renderer's only access point to the preload bridge (`window.mqttIn`).
 *
 * `api` resolves the bridge lazily (so tests can install a fake) and copies every argument
 * into plain data before it crosses the IPC boundary: Vue reactive proxies cannot be
 * structured-cloned ("An object could not be cloned"), so callers may pass store state as is.
 */
import type { MqttInApi } from '@shared/ipc'
import { toPlain } from '@/utils/plain'

const MISSING_BRIDGE =
  'The mqtt-in bridge (window.mqttIn) is not available: the renderer must run inside the mqtt-in ' +
  'desktop app with its preload script.'

let cached: { raw: MqttInApi; safe: MqttInApi } | undefined

function resolveBridge(): MqttInApi {
  const bridge: MqttInApi | undefined = typeof window === 'undefined' ? undefined : window.mqttIn
  if (!bridge) throw new Error(MISSING_BRIDGE)
  return bridge
}

function current(): MqttInApi {
  const raw = resolveBridge()
  if (cached?.raw !== raw) cached = { raw, safe: createSafeApi(raw) }
  return cached.safe
}

/** Wraps every request so its arguments are plain, clone-safe copies. */
function createSafeApi(raw: MqttInApi): MqttInApi {
  const { connections, settings, storage, mqtt, dialog, app, window: win } = raw
  return {
    connections: {
      list: () => connections.list(),
      save: (profile) => connections.save(toPlain(profile)),
      remove: (id) => connections.remove(id),
      reorder: (ids) => connections.reorder(toPlain(ids)),
      importFromFile: () => connections.importFromFile(),
      exportToFile: (ids, options) =>
        connections.exportToFile(
          ids ? toPlain(ids) : undefined,
          options ? toPlain(options) : undefined
        )
    },
    settings: {
      get: () => settings.get(),
      update: (patch) => settings.update(toPlain(patch))
    },
    storage: {
      get: <T = unknown>(key: string) => storage.get<T>(key),
      set: (key, value) => storage.set(key, toPlain(value))
    },
    mqtt: {
      connect: (id) => mqtt.connect(id),
      disconnect: (id) => mqtt.disconnect(id),
      subscribe: (id, subscription) => mqtt.subscribe(id, toPlain(subscription)),
      unsubscribe: (id, subscription) => mqtt.unsubscribe(id, toPlain(subscription)),
      publish: (id, request) => mqtt.publish(id, toPlain(request)),
      startRepeat: (id, options) => mqtt.startRepeat(id, toPlain(options)),
      stopRepeat: (jobId) => mqtt.stopRepeat(jobId),
      getSessions: () => mqtt.getSessions(),
      onStatus: (listener) => mqtt.onStatus(listener),
      onMessages: (listener) => mqtt.onMessages(listener),
      onSubscription: (listener) => mqtt.onSubscription(listener),
      onLog: (listener) => mqtt.onLog(listener),
      onRepeat: (listener) => mqtt.onRepeat(listener)
    },
    dialog: {
      pickFile: (options) => dialog.pickFile(options ? toPlain(options) : undefined),
      openFile: (options) => dialog.openFile(options ? toPlain(options) : undefined),
      saveFile: (options) => dialog.saveFile(toPlain(options))
    },
    app: {
      platform: app.platform,
      getInfo: () => app.getInfo(),
      openExternal: (url) => app.openExternal(url),
      getStorageNotices: () => app.getStorageNotices(),
      onStorageNotice: (listener) => app.onStorageNotice(listener),
      showItemInFolder: (path) => app.showItemInFolder(path)
    },
    window: {
      setTheme: (theme) => win.setTheme(theme)
    }
  }
}

/**
 * Typed bridge to the main process (see `MqttInApi` in `@shared/ipc`).
 * Accessing any namespace throws a clear error when the preload bridge is missing.
 */
export const api: MqttInApi = {
  get connections(): MqttInApi['connections'] {
    return current().connections
  },
  get settings(): MqttInApi['settings'] {
    return current().settings
  },
  get storage(): MqttInApi['storage'] {
    return current().storage
  },
  get mqtt(): MqttInApi['mqtt'] {
    return current().mqtt
  },
  get dialog(): MqttInApi['dialog'] {
    return current().dialog
  },
  get app(): MqttInApi['app'] {
    return current().app
  },
  get window(): MqttInApi['window'] {
    return current().window
  }
}

/** True when the preload bridge is installed (e.g. false in a plain browser tab). */
export function isBridgeAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.mqttIn)
}

const REMOTE_PREFIX = /^Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?/

/**
 * Short, human message of an error. Strips Electron's
 * `Error invoking remote method 'x': Error: ` prefix from rejected IPC calls.
 */
export function errorMessage(err: unknown): string {
  let message: string
  if (err instanceof Error) message = err.message
  else if (typeof err === 'string') message = err
  else if (isMessageLike(err)) message = err.message
  else message = err === undefined || err === null ? '' : String(err)
  return message.replace(REMOTE_PREFIX, '').trim() || 'Unknown error'
}

function isMessageLike(value: unknown): value is { message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof (value as { message: unknown }).message === 'string'
  )
}
