/**
 * Preload bridge (runs sandboxed, context-isolated).
 *
 * Exposes a small, typed, promise-based API as `window.mqttIn`. Only `electron`
 * may be imported at runtime here — `@shared/*` is limited to pure constants
 * that are bundled in.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  IPC_EVENTS,
  type IpcEventChannel,
  type MqttInApi,
  type Unsubscribe
} from '@shared/ipc'

function on<T>(channel: IpcEventChannel, listener: (payload: T) => void): Unsubscribe {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const invoke = ipcRenderer.invoke.bind(ipcRenderer)

const api: MqttInApi = {
  connections: {
    list: () => invoke(IPC.connectionsList),
    save: (profile) => invoke(IPC.connectionsSave, profile),
    remove: (id) => invoke(IPC.connectionsRemove, id),
    reorder: (ids) => invoke(IPC.connectionsReorder, ids),
    importFromFile: () => invoke(IPC.connectionsImport),
    exportToFile: (ids, options) => invoke(IPC.connectionsExport, ids, options)
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    update: (patch) => invoke(IPC.settingsUpdate, patch)
  },
  storage: {
    get: (key) => invoke(IPC.storageGet, key),
    set: (key, value) => invoke(IPC.storageSet, key, value)
  },
  mqtt: {
    connect: (connectionId) => invoke(IPC.mqttConnect, connectionId),
    disconnect: (connectionId) => invoke(IPC.mqttDisconnect, connectionId),
    subscribe: (connectionId, subscription) =>
      invoke(IPC.mqttSubscribe, connectionId, subscription),
    unsubscribe: (connectionId, subscription) =>
      invoke(IPC.mqttUnsubscribe, connectionId, subscription),
    publish: (connectionId, request) => invoke(IPC.mqttPublish, connectionId, request),
    startRepeat: (connectionId, options) => invoke(IPC.mqttRepeatStart, connectionId, options),
    stopRepeat: (jobId) => invoke(IPC.mqttRepeatStop, jobId),
    getSessions: () => invoke(IPC.mqttSessions),
    onStatus: (listener) => on(IPC_EVENTS.status, listener),
    onMessages: (listener) => on(IPC_EVENTS.messages, listener),
    onSubscription: (listener) => on(IPC_EVENTS.subscription, listener),
    onLog: (listener) => on(IPC_EVENTS.log, listener),
    onRepeat: (listener) => on(IPC_EVENTS.repeat, listener)
  },
  dialog: {
    pickFile: (options) => invoke(IPC.dialogPickFile, options),
    openFile: (options) => invoke(IPC.dialogOpenFile, options),
    saveFile: (options) => invoke(IPC.dialogSaveFile, options)
  },
  app: {
    platform: process.platform,
    getInfo: () => invoke(IPC.appInfo),
    openExternal: (url) => invoke(IPC.appOpenExternal, url),
    getStorageNotices: () => invoke(IPC.appStorageNotices),
    onStorageNotice: (listener) => on(IPC_EVENTS.storageNotice, listener),
    showItemInFolder: (path) => invoke(IPC.appShowItemInFolder, path)
  },
  window: {
    setTheme: (theme) => invoke(IPC.windowSetTheme, theme)
  }
}

contextBridge.exposeInMainWorld('mqttIn', api)
