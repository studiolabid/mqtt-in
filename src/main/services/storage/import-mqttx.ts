/**
 * MQTTX connection exports ("Export data" in MQTTX: a list of its `ConnectionModel` objects, or
 * one of them): detection and mapping to mqtey's profile fields. The result is validated like any
 * other import entry.
 *
 * MQTTX differs in units and names: the connect timeout is in seconds, the MQTT version is
 * '3.1' / '3.1.1' / '5.0', TLS is `ssl` plus the `ca` / `cert` / `key` file paths, the Last Will
 * is `will.lastWill*`, user properties are an object, and the subscription options are
 * `nl` / `rap` / `rh`. Its generated client ids (`mqttx_` + 8 hex) are replaced, so a connection
 * still open in MQTTX is not taken over by the imported copy (same client id).
 * Pure (no electron, no file system).
 */
import { generateClientId } from '@shared/defaults'
import type { MqttProtocol, MqttProtocolVersion, UserProperty } from '@shared/models'
import { isRecord } from '../../utils/errors'

type Entry = Record<string, unknown>

const MQTTX_VERSIONS: Readonly<Record<string, MqttProtocolVersion>> = {
  '3.1': 3,
  '3.1.1': 4,
  '5.0': 5,
  '5': 5
}

const MQTTX_GENERATED_CLIENT_ID = /^mqttx_[0-9a-f]{8}$/i

/** Fields with the same name and meaning in both formats. */
const SAME_FIELDS = [
  'name',
  'host',
  'port',
  'path',
  'clientId',
  'username',
  'password',
  'clean',
  'keepalive',
  'reconnectPeriod'
] as const

/** Connect properties MQTTX 1.x kept on the connection itself. */
const CONNECT_PROPERTY_FIELDS = [
  'sessionExpiryInterval',
  'receiveMaximum',
  'maximumPacketSize',
  'topicAliasMaximum',
  'requestResponseInformation',
  'requestProblemInformation'
] as const

const WILL_PROPERTY_FIELDS = [
  'willDelayInterval',
  'payloadFormatIndicator',
  'messageExpiryInterval',
  'contentType',
  'responseTopic'
] as const

function isEntry(value: unknown): value is Entry {
  return isRecord(value) && !Array.isArray(value)
}

/** True for an MQTTX connection: it has keys that mqtey profiles never have. */
export function isMqttxEntry(entry: unknown): boolean {
  if (!isEntry(entry)) return false
  return (
    'mqttVersion' in entry ||
    typeof entry.ssl === 'boolean' ||
    typeof entry.reconnect === 'boolean' ||
    (isEntry(entry.will) && 'lastWillTopic' in entry.will)
  )
}

/**
 * The connections of an MQTTX collection tree (`isCollection` folders with `children`), in order,
 * with the folder name as their group. Other entries are returned as they are.
 */
export function flattenMqttxCollections(entries: readonly unknown[], group = ''): unknown[] {
  const out: unknown[] = []
  for (const entry of entries) {
    if (isEntry(entry) && entry.isCollection === true && Array.isArray(entry.children)) {
      const name = typeof entry.name === 'string' ? entry.name : group
      out.push(...flattenMqttxCollections(entry.children, name))
    } else if (group !== '' && isEntry(entry)) out.push({ ...entry, collectionName: group })
    else out.push(entry)
  }
  return out
}

function pick(source: Entry, keys: readonly string[]): Entry {
  const out: Entry = {}
  for (const key of keys) if (key in source) out[key] = source[key]
  return out
}

/** `{ a: '1', b: ['2', '3'] }` (MQTTX) → `[{ key: 'a', value: '1' }, …]`; lists are kept. */
function userProperties(value: unknown): unknown {
  if (Array.isArray(value) || !isEntry(value)) return value ?? undefined
  const list: UserProperty[] = []
  for (const [key, item] of Object.entries(value)) {
    for (const one of Array.isArray(item) ? item : [item]) {
      if (typeof one === 'string') list.push({ key, value: one })
    }
  }
  return list
}

function protocolOf(entry: Entry): MqttProtocol {
  const protocol = typeof entry.protocol === 'string' ? entry.protocol.toLowerCase() : 'mqtt'
  const ws = protocol.startsWith('ws')
  const secure = entry.ssl === true || protocol === 'wss' || protocol === 'mqtts'
  return ws ? (secure ? 'wss' : 'ws') : secure ? 'mqtts' : 'mqtt'
}

function tlsOf(entry: Entry): Entry {
  const tls: Entry = {}
  if (typeof entry.rejectUnauthorized === 'boolean')
    tls.rejectUnauthorized = entry.rejectUnauthorized
  // 'server' = a CA-signed broker certificate (system CAs): MQTTX ignores the files then.
  if (entry.certType !== 'server') {
    if (typeof entry.ca === 'string') tls.caPath = entry.ca
    if (typeof entry.cert === 'string') tls.certPath = entry.cert
    if (typeof entry.key === 'string') tls.keyPath = entry.key
  }
  if (typeof entry.ALPNProtocols === 'string') {
    tls.alpnProtocols = entry.ALPNProtocols.split(',')
      .map((protocol) => protocol.trim())
      .filter((protocol) => protocol !== '')
  }
  return tls
}

function willOf(will: Entry): Entry {
  const topic = typeof will.lastWillTopic === 'string' ? will.lastWillTopic : ''
  const out: Entry = { enabled: topic !== '', topic }
  if ('lastWillPayload' in will) out.payload = will.lastWillPayload
  if ('lastWillQos' in will) out.qos = will.lastWillQos
  if ('lastWillRetain' in will) out.retain = will.lastWillRetain
  if (isEntry(will.properties)) {
    const props = will.properties
    out.properties = {
      ...pick(props, WILL_PROPERTY_FIELDS),
      // Binary in MQTTX's own files (a serialized Buffer): only text is kept.
      ...(typeof props.correlationData === 'string'
        ? { correlationData: props.correlationData }
        : {}),
      userProperties: userProperties(props.userProperties) ?? []
    }
  }
  return out
}

function connectPropertiesOf(entry: Entry): Entry {
  const nested = isEntry(entry.properties) ? entry.properties : {}
  const props: Entry = {
    ...pick(entry, CONNECT_PROPERTY_FIELDS),
    ...pick(nested, CONNECT_PROPERTY_FIELDS)
  }
  props.userProperties = userProperties(nested.userProperties) ?? []
  return props
}

function subscriptionOf(sub: unknown): unknown {
  if (!isEntry(sub)) return sub
  const out: Entry = pick(sub, ['topic', 'qos', 'alias', 'color', 'subscriptionIdentifier'])
  if (typeof sub.disabled === 'boolean') out.enabled = !sub.disabled
  if ('nl' in sub) out.noLocal = sub.nl
  if ('rap' in sub) out.retainAsPublished = sub.rap
  if ('rh' in sub) out.retainHandling = sub.rh
  return out
}

/**
 * An mqtey-shaped profile entry for an MQTTX connection. Fields MQTTX has no equivalent for keep
 * mqtey's defaults; values of the wrong type are passed on, so validation names the bad field.
 */
export function fromMqttx(entry: Entry): Entry {
  const out: Entry = pick(entry, SAME_FIELDS)
  out.protocol = protocolOf(entry)
  if (typeof entry.collectionName === 'string') out.group = entry.collectionName
  if ('connectTimeout' in entry) {
    const seconds = entry.connectTimeout
    out.connectTimeout = typeof seconds === 'number' ? Math.round(seconds * 1000) : seconds
  }
  if ('mqttVersion' in entry) {
    const version = entry.mqttVersion
    out.protocolVersion =
      typeof version === 'string' ? (MQTTX_VERSIONS[version] ?? version) : version
  }
  if ('reconnect' in entry) out.autoReconnect = entry.reconnect
  out.tls = tlsOf(entry)
  if (isEntry(entry.will)) out.will = willOf(entry.will)
  out.properties = connectPropertiesOf(entry)
  if (Array.isArray(entry.subscriptions))
    out.subscriptions = entry.subscriptions.map(subscriptionOf)
  if (typeof out.clientId === 'string' && MQTTX_GENERATED_CLIENT_ID.test(out.clientId)) {
    out.clientId = generateClientId()
  }
  return out
}
