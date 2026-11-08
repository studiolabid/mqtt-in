/**
 * IPC contract between the main process and the renderer.
 *
 * The preload script exposes `MqttInApi` as `window.mqttIn`. Every request is an
 * `ipcRenderer.invoke` on one of `IPC.*` channels; every event is pushed by the
 * main process with `webContents.send` on one of `IPC_EVENTS.*`.
 *
 * The renderer must never touch `window.mqttIn` directly — use `@/services/api`.
 */
import type {
  AppInfo,
  AppSettings,
  ConnectionProfile,
  ConnectionTestResult,
  ExportConnectionsOptions,
  ImportConnectionsResult,
  LogEntry,
  MqttMessage,
  OpenFileResult,
  PickFileOptions,
  PublishRequest,
  RepeatJobEvent,
  RepeatPublishOptions,
  SaveFileOptions,
  SessionSnapshot,
  StatusEvent,
  StorageNotice,
  Subscription,
  SubscriptionEvent,
  ThemeMode
} from './models'

/** Request/response channels (ipcMain.handle ↔ ipcRenderer.invoke). */
export const IPC = {
  connectionsList: 'connections:list',
  connectionsSave: 'connections:save',
  connectionsRemove: 'connections:remove',
  connectionsReorder: 'connections:reorder',
  connectionsImport: 'connections:import',
  connectionsExport: 'connections:export',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',

  storageGet: 'storage:get',
  storageSet: 'storage:set',

  mqttConnect: 'mqtt:connect',
  mqttDisconnect: 'mqtt:disconnect',
  mqttSubscribe: 'mqtt:subscribe',
  mqttUnsubscribe: 'mqtt:unsubscribe',
  mqttPublish: 'mqtt:publish',
  mqttRepeatStart: 'mqtt:repeat-start',
  mqttRepeatStop: 'mqtt:repeat-stop',
  mqttSessions: 'mqtt:sessions',
  mqttTest: 'mqtt:test',

  dialogPickFile: 'dialog:pick-file',
  dialogOpenFile: 'dialog:open-file',
  dialogSaveFile: 'dialog:save-file',

  appInfo: 'app:info',
  appOpenExternal: 'app:open-external',
  appStorageNotices: 'app:storage-notices',
  appShowItemInFolder: 'app:show-item-in-folder',

  windowSetTheme: 'window:set-theme'
} as const

/** Push channels (webContents.send → ipcRenderer.on). */
export const IPC_EVENTS = {
  status: 'mqtt:event:status',
  messages: 'mqtt:event:messages',
  subscription: 'mqtt:event:subscription',
  log: 'mqtt:event:log',
  repeat: 'mqtt:event:repeat',
  storageNotice: 'app:event:storage-notice'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
export type IpcEventChannel = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS]

/** Returned by every `on*` subscription; call it to stop listening. */
export type Unsubscribe = () => void

export interface MqttInApi {
  connections: {
    list(): Promise<ConnectionProfile[]>
    /** Insert or update (by id). Returns the stored profile (updatedAt refreshed). */
    save(profile: ConnectionProfile): Promise<ConnectionProfile>
    remove(id: string): Promise<void>
    /** Persist the sidebar order. Unknown ids are ignored. */
    reorder(ids: string[]): Promise<void>
    /**
     * Opens a file dialog and imports the chosen file: the valid entries are saved with fresh
     * ids, the outcome says what was skipped and why. `null` = cancelled. Rejects only for an
     * unrecognized file, or when it holds no valid entry and no duplicate.
     */
    importFromFile(): Promise<ImportConnectionsResult | null>
    /**
     * Opens a save dialog and exports the given ids (all when omitted). Passwords and TLS
     * passphrases are left out unless `options.includeSecrets`. Returns the path or `null`.
     */
    exportToFile(ids?: string[], options?: ExportConnectionsOptions): Promise<string | null>
  }

  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
  }

  /** Small persistent key/value store for UI data (publish history, layout…). */
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>
    set(key: string, value: unknown): Promise<void>
  }

  mqtt: {
    /**
     * Connects the saved profile `connectionId` (the main process reads the
     * persisted profile — save first). Resolves once the attempt has started;
     * progress is reported through `onStatus`. Enabled subscriptions of the
     * profile are subscribed automatically after CONNACK.
     */
    connect(connectionId: string): Promise<void>
    /** Graceful disconnect (also cancels auto-reconnect and repeat jobs). */
    disconnect(connectionId: string): Promise<void>
    /** Subscribe on a connected session. Resolves with the final state. */
    subscribe(connectionId: string, subscription: Subscription): Promise<SubscriptionEvent>
    unsubscribe(connectionId: string, subscription: Subscription): Promise<SubscriptionEvent>
    /** Rejects with an Error when not connected or the broker refuses the publish. */
    publish(connectionId: string, request: PublishRequest): Promise<void>
    /** Starts a repeat-publish job; returns its job id. */
    startRepeat(connectionId: string, options: RepeatPublishOptions): Promise<string>
    stopRepeat(jobId: string): Promise<void>
    /** Current state of every session known to the main process (survives renderer reloads). */
    getSessions(): Promise<SessionSnapshot[]>
    /**
     * Connects once with `profile` (saved or not), then disconnects cleanly. Never rejects for
     * broker or network problems: the result says what happened.
     */
    test(profile: ConnectionProfile): Promise<ConnectionTestResult>

    onStatus(listener: (event: StatusEvent) => void): Unsubscribe
    /** Batched (~50 ms) incoming AND outgoing messages, in order. */
    onMessages(listener: (batch: MqttMessage[]) => void): Unsubscribe
    onSubscription(listener: (event: SubscriptionEvent) => void): Unsubscribe
    onLog(listener: (entry: LogEntry) => void): Unsubscribe
    onRepeat(listener: (event: RepeatJobEvent) => void): Unsubscribe
  }

  dialog: {
    /** Returns the chosen absolute path (e.g. TLS certificates) or `null`. */
    pickFile(options?: PickFileOptions): Promise<string | null>
    /** Picks and reads a file (max 32 MB). `null` = cancelled. */
    openFile(options?: PickFileOptions): Promise<OpenFileResult | null>
    /** Shows a save dialog and writes `content`. Returns the path or `null`. */
    saveFile(options: SaveFileOptions): Promise<string | null>
  }

  app: {
    /** `process.platform` of the host (sync). */
    readonly platform: string
    getInfo(): Promise<AppInfo>
    /** Opens http(s)/mailto URLs in the default browser. */
    openExternal(url: string): Promise<void>
    /**
     * Every storage problem of this session (unreadable or corrupt files, restored backups,
     * skipped entries, failed writes…), oldest first. They are not cleared during the session.
     */
    getStorageNotices(): Promise<StorageNotice[]>
    /** Storage problems raised after the window opened (e.g. a failed write). */
    onStorageNotice(listener: (notice: StorageNotice) => void): Unsubscribe
    /**
     * Shows a file in the OS file manager. Only for absolute paths the main process wrote or
     * reported in this session (saved files, connection exports, storage-notice paths): rejects
     * with 'Unknown file' otherwise.
     */
    showItemInFolder(path: string): Promise<void>
  }

  window: {
    /** Syncs `nativeTheme.themeSource` and the title-bar overlay symbol colors. */
    setTheme(theme: ThemeMode): Promise<void>
  }
}
