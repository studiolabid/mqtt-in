/**
 * Validation of the connection form (pure). It applies the rules of the main-process profile
 * schema (strict mode) from the same shared sources, so a form that passes here is accepted by
 * `connections.save`, and a refused value is explained at its field (SEC-11, SEC-03):
 * - the host through `validateBrokerHost` (no scheme, port, path or credentials);
 * - keep alive, connect timeout and reconnect period through `LIMITS`;
 * - MQTT strings (client id, username, will properties, user properties) with
 *   `mqttStringProblem`: at most 65,535 UTF-8 bytes and no unpaired surrogate (CT-06); topic
 *   names (will topic, response topic) with `validateTopicName`, which applies the same rule;
 *   binary fields (password, will payload, correlation data) at most 65,535 bytes.
 *
 * WebSocket and Socket.IO connections skip the MQTT-only fields (client id, credentials, Last
 * Will, MQTT 5) and check their handshake headers, subprotocols and Socket.IO auth instead.
 */
import type { ConnectionProfile, UserProperty } from '@shared/models'
import {
  connectionKind,
  headerProblem,
  socketAuthProblem,
  socketSettings,
  subprotocolsProblem
} from '@shared/connection-kind'
import { LIMITS } from '@shared/defaults'
import { MQTT_STRING_MAX_BYTES, mqttStringProblem, utf8ByteLength } from '@shared/mqtt-string'
import { validateTopicName } from '@shared/topic'
import { validateBrokerHost } from '@shared/validation'
import { FORM_SECTIONS, type FormSectionId } from './sections'

export const UINT16_MAX = 65_535
export const UINT32_MAX = 4_294_967_295

/** Form fields that can carry a validation error. */
export type FieldKey =
  | 'name'
  | 'host'
  | 'port'
  | 'clientId'
  | 'username'
  | 'password'
  | 'servername'
  | 'keepalive'
  | 'connectTimeout'
  | 'reconnectPeriod'
  | 'willTopic'
  | 'willPayload'
  | 'willDelayInterval'
  | 'willMessageExpiryInterval'
  | 'willContentType'
  | 'willResponseTopic'
  | 'willCorrelationData'
  | 'willUserProperties'
  | 'sessionExpiryInterval'
  | 'receiveMaximum'
  | 'maximumPacketSize'
  | 'topicAliasMaximum'
  | 'userProperties'
  | 'socketHeaders'
  | 'subprotocols'
  | 'socketAuth'

export type FormErrors = Partial<Record<FieldKey, string>>

/** The section that shows each field (nav error dots, "jump to the first error"). */
const FIELD_SECTIONS: Readonly<Record<FieldKey, FormSectionId>> = {
  name: 'general',
  host: 'general',
  port: 'general',
  clientId: 'general',
  username: 'auth',
  password: 'auth',
  servername: 'tls',
  keepalive: 'advanced',
  connectTimeout: 'advanced',
  reconnectPeriod: 'advanced',
  willTopic: 'will',
  willPayload: 'will',
  willDelayInterval: 'will',
  willMessageExpiryInterval: 'will',
  willContentType: 'will',
  willResponseTopic: 'will',
  willCorrelationData: 'will',
  willUserProperties: 'will',
  sessionExpiryInterval: 'mqtt5',
  receiveMaximum: 'mqtt5',
  maximumPacketSize: 'mqtt5',
  topicAliasMaximum: 'mqtt5',
  userProperties: 'mqtt5',
  socketHeaders: 'socket',
  subprotocols: 'socket',
  socketAuth: 'socket'
}

function isIntegerIn(value: number | undefined, min: number, max: number): boolean {
  return value !== undefined && Number.isInteger(value) && value >= min && value <= max
}

/** Optional numbers: empty (`undefined`) is fine, anything else must be in range. */
function checkOptional(
  errors: FormErrors,
  key: FieldKey,
  value: number | undefined,
  min: number,
  max: number
): void {
  if (value === undefined || isIntegerIn(value, min, max)) return
  errors[key] = `Use a whole number from ${min} to ${max}, or leave empty`
}

/** An MQTT UTF-8 string field: `<Label> is too long (max 65535 bytes)` and the like. */
function checkString(errors: FormErrors, key: FieldKey, value: string, label: string): void {
  const problem = mqttStringProblem(value)
  if (problem) errors[key] = `${label} ${problem}`
}

/** A binary field: at most 65,535 bytes. */
function checkBinary(errors: FormErrors, key: FieldKey, value: string, label: string): void {
  if (utf8ByteLength(value) > MQTT_STRING_MAX_BYTES) {
    errors[key] = `${label} is too long (max ${MQTT_STRING_MAX_BYTES} bytes)`
  }
}

/** The first user property whose key or value is no valid MQTT string. */
function userPropertiesProblem(list: readonly UserProperty[]): string | null {
  for (const [index, property] of list.entries()) {
    const key = mqttStringProblem(property.key)
    if (key) return `User property ${index + 1}: the key ${key}`
    const value = mqttStringProblem(property.value)
    if (value) return `User property ${index + 1}: the value ${value}`
  }
  return null
}

/**
 * The Last Will: its topic must be valid while the will is enabled; everything else is checked
 * either way, like the main process does (a stored will keeps its values while turned off).
 */
function checkWill(errors: FormErrors, will: ConnectionProfile['will']): void {
  if (will.enabled) {
    // A topic name: no wildcards, and an MQTT string (65,535 bytes, no unpaired surrogate).
    const problem = validateTopicName(will.topic)
    if (problem) errors.willTopic = problem
  } else {
    checkString(errors, 'willTopic', will.topic, 'Will topic')
  }
  checkBinary(errors, 'willPayload', will.payload, 'Will payload')
  const props = will.properties
  checkOptional(errors, 'willDelayInterval', props.willDelayInterval, 0, UINT32_MAX)
  checkOptional(errors, 'willMessageExpiryInterval', props.messageExpiryInterval, 0, UINT32_MAX)
  checkString(errors, 'willContentType', props.contentType ?? '', 'Content type')
  const responseTopic = props.responseTopic ?? ''
  const responseProblem = responseTopic === '' ? null : validateTopicName(responseTopic)
  if (responseProblem) errors.willResponseTopic = responseProblem
  checkBinary(errors, 'willCorrelationData', props.correlationData ?? '', 'Correlation data')
  const userProblem = userPropertiesProblem(props.userProperties)
  if (userProblem) errors.willUserProperties = userProblem
}

/** WebSocket / Socket.IO options: headers, subprotocols (WebSocket), auth JSON (Socket.IO). */
function checkSocket(errors: FormErrors, draft: ConnectionProfile): void {
  const socket = socketSettings(draft)
  for (const [index, header] of socket.headers.entries()) {
    if (header.key.trim() === '' && header.value === '') continue
    const problem = headerProblem(header.key, header.value)
    if (problem) {
      errors.socketHeaders = `Header ${index + 1}: ${problem}`
      break
    }
  }
  const kind = connectionKind(draft)
  const subprotocols = kind === 'websocket' ? subprotocolsProblem(socket.subprotocols) : null
  if (subprotocols) errors.subprotocols = subprotocols
  const auth = kind === 'socketio' ? socketAuthProblem(socket.auth) : null
  if (auth) errors.socketAuth = auth
}

/** Every problem of the draft, keyed by field (empty object = valid). */
export function validateConnection(draft: ConnectionProfile): FormErrors {
  const errors: FormErrors = {}

  const name = draft.name.trim()
  if (name === '') errors.name = 'Name is required'
  else if (name.length > 256) errors.name = 'Name is too long (max 256 characters)'

  const hostProblem = validateBrokerHost(draft.host)
  if (hostProblem) errors.host = hostProblem

  if (!isIntegerIn(draft.port, 1, UINT16_MAX)) errors.port = 'Port must be between 1 and 65535'
  const mqtt = connectionKind(draft) === 'mqtt'
  if (mqtt) {
    checkString(errors, 'clientId', draft.clientId.trim(), 'Client ID')
    checkString(errors, 'username', draft.username, 'Username')
    checkBinary(errors, 'password', draft.password, 'Password')
  } else {
    checkSocket(errors, draft)
  }
  if (draft.tls.servername.trim().length > 255) {
    errors.servername = 'Server name is too long (max 255 characters)'
  }

  const { keepaliveS, connectTimeoutMs, reconnectPeriodMs } = LIMITS
  if (!isIntegerIn(draft.keepalive, keepaliveS.min, keepaliveS.max)) {
    errors.keepalive = `Keep alive must be between ${keepaliveS.min} and ${keepaliveS.max} s`
  }
  if (!isIntegerIn(draft.connectTimeout, connectTimeoutMs.min, connectTimeoutMs.max)) {
    errors.connectTimeout = `Connect timeout must be between ${connectTimeoutMs.min / 1000} and ${connectTimeoutMs.max / 1000} s`
  }
  if (
    draft.autoReconnect &&
    !isIntegerIn(draft.reconnectPeriod, reconnectPeriodMs.min, reconnectPeriodMs.max)
  ) {
    errors.reconnectPeriod = `Reconnect period must be between ${reconnectPeriodMs.min / 1000} and ${reconnectPeriodMs.max / 1000} s`
  }

  if (!mqtt) return errors
  checkWill(errors, draft.will)

  const props = draft.properties
  checkOptional(errors, 'sessionExpiryInterval', props.sessionExpiryInterval, 0, UINT32_MAX)
  checkOptional(errors, 'receiveMaximum', props.receiveMaximum, 1, UINT16_MAX)
  checkOptional(errors, 'maximumPacketSize', props.maximumPacketSize, 1, UINT32_MAX)
  checkOptional(errors, 'topicAliasMaximum', props.topicAliasMaximum, 0, UINT16_MAX)
  const userProblem = userPropertiesProblem(props.userProperties)
  if (userProblem) errors.userProperties = userProblem

  return errors
}

/**
 * Hint of the client id field (MQTT-07): with clean start off and no client id, the session
 * could never be resumed with a new id on every connect, so one is generated when saving
 * (`normalizeConnectionProfile`, CT-09). `null` otherwise.
 */
export function persistentSessionHint(
  draft: Pick<ConnectionProfile, 'clean' | 'clientId'>
): string | null {
  return !draft.clean && draft.clientId.trim() === ''
    ? 'A persistent session needs a fixed client ID — one is generated when you save'
    : null
}

/** Number of errors per section. */
export function countErrorsBySection(errors: FormErrors): Record<FormSectionId, number> {
  const counts = Object.fromEntries(FORM_SECTIONS.map((s) => [s.id, 0])) as Record<
    FormSectionId,
    number
  >
  for (const key of Object.keys(errors) as FieldKey[]) {
    if (errors[key]) counts[FIELD_SECTIONS[key]] += 1
  }
  return counts
}

/** The first section (in navigation order) that has an error, or null. */
export function firstInvalidSection(errors: FormErrors): FormSectionId | null {
  const counts = countErrorsBySection(errors)
  return FORM_SECTIONS.find((section) => counts[section.id] > 0)?.id ?? null
}
