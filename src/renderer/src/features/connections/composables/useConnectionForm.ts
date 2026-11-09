/**
 * State and logic of the connection dialog: the draft (always a plain copy, never a store
 * object), dirty tracking, validation (displayed after the first save attempt, live
 * afterwards; the rules and limits of the main-process schema, `utils/validate`), section
 * errors and the field helpers shared by the sections.
 *
 * `ConnectionFormDialog` creates the form with `createConnectionForm()` and provides it; the
 * section components read it with `useConnectionForm()`.
 */
import { computed, inject, provide, ref, type ComputedRef, type InjectionKey, type Ref } from 'vue'
import type {
  ConnectionKind,
  ConnectionProfile,
  MqttProtocol,
  MqttProtocolVersion,
  UserProperty
} from '@shared/models'
import {
  createConnectionProfile,
  DEFAULT_PORTS,
  generateClientId,
  isWebSocketProtocol,
  LIMITS
} from '@shared/defaults'
import {
  connectionKind,
  KIND_DEFAULT_PATHS,
  protocolForKind,
  socketSettings
} from '@shared/connection-kind'
import { toPlain } from '@/utils/plain'
import { parseBrokerUrl, type ParsedBrokerUrl } from '../utils/broker-url'
import type { FormSectionId } from '../utils/sections'
import { formSnapshot } from '../utils/snapshot'
import {
  countErrorsBySection,
  firstInvalidSection,
  validateConnection,
  type FormErrors
} from '../utils/validate'

export type ConnectionFormMode = 'create' | 'edit'

/** Footer actions: Save, or Save & connect / reconnect. */
export type SaveIntent = 'save' | 'connect'

export interface ConnectionForm {
  /** The edited profile (plain, deeply reactive data). Sections bind to its fields. */
  draft: Ref<ConnectionProfile>
  mode: Ref<ConnectionFormMode>
  /** The section shown by the dialog. */
  section: Ref<FormSectionId>
  /** Errors to display: none until the first save attempt, live afterwards. */
  errors: ComputedRef<FormErrors>
  /** Displayed errors per section (navigation dots). */
  sectionErrors: ComputedRef<Record<FormSectionId, number>>
  errorCount: ComputedRef<number>
  /** The draft differs from what was loaded (or last saved). */
  dirty: ComputedRef<boolean>
  /** Existing group names (suggestions for the group field). */
  groupSuggestions: ComputedRef<readonly string[]>
  /** Starts editing a plain copy of `profile`. */
  reset(profile: ConnectionProfile, mode: ConnectionFormMode): void
  /** Accepts the current draft as saved (no unsaved-changes prompt afterwards). */
  markClean(): void
  /** Reveals the errors; returns the first invalid section, or null when the draft is valid. */
  validate(): FormSectionId | null
  /** A sanitized plain profile, ready to be saved. */
  build(): ConnectionProfile
  /**
   * Changes what the connection talks to: the protocol moves to one the kind supports (mqtt →
   * ws, mqtts → wss), a default path follows the kind, and socket settings are filled in.
   */
  setKind(kind: ConnectionKind): void
  /** Changes the transport; a default port follows the protocol. */
  setProtocol(protocol: MqttProtocol): void
  setVersion(version: MqttProtocolVersion): void
  /** Applies a pasted broker URL (`mqtts://user:pass@host:8883`); null when it is not one. */
  applyBrokerUrl(text: string): ParsedBrokerUrl | null
  regenerateClientId(): void
  /** Runs the dialog's primary action (e.g. Mod+Enter inside the will payload editor). */
  submit(): void
}

export interface ConnectionFormOptions {
  /** Primary action of the dialog. */
  onSubmit: () => void
  /** Existing group names. */
  groupNames: () => readonly string[]
}

const DEFAULT_PORT_VALUES: readonly number[] = Object.values(DEFAULT_PORTS)

const CONNECT_NUMBERS = [
  'sessionExpiryInterval',
  'receiveMaximum',
  'maximumPacketSize',
  'topicAliasMaximum'
] as const
const WILL_NUMBERS = ['willDelayInterval', 'messageExpiryInterval'] as const
const WILL_STRINGS = ['contentType', 'responseTopic', 'correlationData'] as const

/** Rows the user added but left blank are not sent. */
function cleanUserProperties(list: UserProperty[]): UserProperty[] {
  return list.filter((property) => property.key.trim() !== '' || property.value !== '')
}

export function createConnectionForm(options: ConnectionFormOptions): ConnectionForm {
  const draft = ref<ConnectionProfile>(createConnectionProfile())
  const mode = ref<ConnectionFormMode>('create')
  const section = ref<FormSectionId>('general')
  const submitted = ref(false)
  const baseline = ref(formSnapshot(draft.value))

  const allErrors = computed(() => validateConnection(draft.value))
  const errors = computed<FormErrors>(() => (submitted.value ? allErrors.value : {}))
  const sectionErrors = computed(() => countErrorsBySection(errors.value))
  const errorCount = computed(() => Object.values(errors.value).filter(Boolean).length)
  const dirty = computed(() => formSnapshot(draft.value) !== baseline.value)
  const groupSuggestions = computed(() => options.groupNames())

  function reset(profile: ConnectionProfile, nextMode: ConnectionFormMode): void {
    draft.value = toPlain(profile)
    mode.value = nextMode
    section.value = 'general'
    submitted.value = false
    baseline.value = formSnapshot(draft.value)
  }

  function markClean(): void {
    baseline.value = formSnapshot(draft.value)
  }

  function validate(): FormSectionId | null {
    submitted.value = true
    return firstInvalidSection(allErrors.value)
  }

  function build(): ConnectionProfile {
    const profile = toPlain(draft.value)
    profile.name = profile.name.trim()
    profile.host = profile.host.trim()
    profile.group = profile.group.trim()
    profile.clientId = profile.clientId.trim()
    profile.path = profile.path.trim()
    profile.tls.servername = profile.tls.servername.trim()
    profile.tls.alpnProtocols = profile.tls.alpnProtocols
      .map((protocol) => protocol.trim())
      .filter((protocol) => protocol !== '')

    // The period is hidden (not validated) while auto reconnect is off: repair garbage only.
    const period = profile.reconnectPeriod
    if (!Number.isInteger(period) || period < 0 || period > LIMITS.reconnectPeriodMs.max) {
      profile.reconnectPeriod = createConnectionProfile().reconnectPeriod
    }

    // Empty / unparsable optional values mean "not sent".
    for (const key of CONNECT_NUMBERS) {
      if (!Number.isFinite(profile.properties[key])) delete profile.properties[key]
    }
    const will = profile.will.properties
    for (const key of WILL_NUMBERS) if (!Number.isFinite(will[key])) delete will[key]
    for (const key of WILL_STRINGS) if (!will[key]) delete will[key]

    profile.properties.userProperties = cleanUserProperties(profile.properties.userProperties)
    will.userProperties = cleanUserProperties(will.userProperties)
    if (connectionKind(profile) !== 'mqtt') {
      const socket = socketSettings(profile)
      socket.headers = cleanUserProperties(socket.headers).map((header) => ({
        key: header.key.trim(),
        value: header.value
      }))
      socket.subprotocols = socket.subprotocols.trim()
      socket.namespace = socket.namespace.trim()
      socket.topicField = socket.topicField.trim()
      profile.socket = socket
    }
    return profile
  }

  /** The kind's default path, used when the path is empty or still another kind's default. */
  function defaultPath(): string {
    return KIND_DEFAULT_PATHS[connectionKind(draft.value)]
  }

  function setKind(kind: ConnectionKind): void {
    const profile = draft.value
    if (connectionKind(profile) === kind) return
    const path = profile.path.trim()
    const defaultBefore = path === '' || Object.values(KIND_DEFAULT_PATHS).includes(path)
    profile.kind = kind
    setProtocol(protocolForKind(kind, profile.protocol))
    if (defaultBefore) profile.path = defaultPath()
    if (kind !== 'mqtt') profile.socket = socketSettings(profile)
  }

  function setProtocol(protocol: MqttProtocol): void {
    const profile = draft.value
    if (profile.protocol === protocol) return
    if (!Number.isFinite(profile.port) || DEFAULT_PORT_VALUES.includes(profile.port)) {
      profile.port = DEFAULT_PORTS[protocol]
    }
    if (isWebSocketProtocol(protocol) && profile.path.trim() === '') profile.path = defaultPath()
    profile.protocol = protocol
  }

  function setVersion(version: MqttProtocolVersion): void {
    draft.value.protocolVersion = version
  }

  function applyBrokerUrl(text: string): ParsedBrokerUrl | null {
    const parsed = parseBrokerUrl(text)
    if (!parsed) return null
    const profile = draft.value
    if (parsed.protocol) profile.protocol = parsed.protocol
    profile.host = parsed.host
    profile.port = parsed.port
    if (parsed.path !== undefined) profile.path = parsed.path
    else if (isWebSocketProtocol(profile.protocol) && profile.path.trim() === '') {
      profile.path = defaultPath()
    }
    if (parsed.username !== undefined) profile.username = parsed.username
    if (parsed.password !== undefined) profile.password = parsed.password
    return parsed
  }

  function regenerateClientId(): void {
    draft.value.clientId = generateClientId()
  }

  return {
    draft,
    mode,
    section,
    errors,
    sectionErrors,
    errorCount,
    dirty,
    groupSuggestions,
    setKind,
    reset,
    markClean,
    validate,
    build,
    setProtocol,
    setVersion,
    applyBrokerUrl,
    regenerateClientId,
    submit: () => options.onSubmit()
  }
}

const FORM_KEY: InjectionKey<ConnectionForm> = Symbol('connection-form')

export function provideConnectionForm(form: ConnectionForm): void {
  provide(FORM_KEY, form)
}

/** The form of the enclosing `ConnectionFormDialog`. */
export function useConnectionForm(): ConnectionForm {
  const form = inject(FORM_KEY, null)
  if (!form) throw new Error('useConnectionForm() must be used inside ConnectionFormDialog')
  return form
}
