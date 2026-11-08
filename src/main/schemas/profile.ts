/**
 * Validation of connection profiles and subscriptions (IPC input, files on disk, imports).
 *
 * The schemas are lenient about *missing* fields (older files, hand-written imports) but
 * strict about the type and range of present ones. Unknown keys are stripped. The result
 * is completed by `normalizeConnectionProfile` / `createSubscription` from `@shared/defaults`.
 *
 * Two modes (`ProfileMode`):
 * - 'strict', for saves over IPC and imports: the rules of the connection form. MQTT strings are
 *   limited in UTF-8 bytes (`mqttStringProblem`), the host must be a bare host name or address
 *   (`validateBrokerHost`: no scheme, port or credentials, which would end up in logs), the
 *   reconnect period is at least `LIMITS.reconnectPeriodMs.min` while auto reconnect is on, and an
 *   enabled Last Will needs a valid topic.
 * - 'lenient', for `connections.json` on load: the type and range checks only, so a profile that
 *   an earlier version saved is never dropped. The session refuses what it cannot send.
 */
import { z } from 'zod'
import { createSubscription, LIMITS, normalizeConnectionProfile } from '@shared/defaults'
import type { ConnectionProfile, Subscription, UserProperty } from '@shared/models'
import { MQTT_STRING_MAX_BYTES, mqttStringProblem, utf8ByteLength } from '@shared/mqtt-string'
import { validateTopicName } from '@shared/topic'
import { validateBrokerHost } from '@shared/validation'
import {
  formatIssues,
  optional,
  qosSchema,
  stripUndefined,
  timestampSchema,
  topicFilterSchema,
  UINT16_MAX,
  uint16Schema,
  uint32Schema,
  UINT32_MAX,
  userPropertiesSchemaFor,
  VARINT_MAX
} from './common'
import { MQTT_PROTOCOLS } from './enums'

export type ProfileMode = 'strict' | 'lenient'

const idSchema = z.string().min(1).max(128)
const retainHandlingSchema = z.union([z.literal(0), z.literal(1), z.literal(2)])
const protocolVersionSchema = z.union([z.literal(3), z.literal(4), z.literal(5)], {
  error: 'Protocol version must be 3 (MQTT 3.1), 4 (MQTT 3.1.1) or 5 (MQTT 5.0)'
})
const storedUserProperties = userPropertiesSchemaFor(false)

const subscriptionFields = {
  id: idSchema,
  topic: z.string().min(1, 'Topic filter is required').max(UINT16_MAX),
  qos: qosSchema,
  color: z.string().max(64),
  alias: z.string().max(256),
  enabled: z.boolean(),
  noLocal: z.boolean(),
  retainAsPublished: z.boolean(),
  retainHandling: retainHandlingSchema,
  subscriptionIdentifier: optional(z.number().int().min(1).max(VARINT_MAX)),
  createdAt: timestampSchema
}

/** A stored / imported subscription: everything but the topic may be missing. */
const storedSubscriptionSchema = z.object(subscriptionFields).partial().required({ topic: true })

/** A subscription sent to `mqtt.subscribe` / `mqtt.unsubscribe`: id and a valid filter required. */
const liveSubscriptionSchema = z
  .object({ ...subscriptionFields, topic: topicFilterSchema })
  .partial()
  .required({ id: true, topic: true })

const tlsSchema = z
  .object({
    rejectUnauthorized: z.boolean(),
    caPath: z.string().max(4096),
    certPath: z.string().max(4096),
    keyPath: z.string().max(4096),
    passphrase: z.string().max(UINT16_MAX),
    servername: z.string().max(255),
    alpnProtocols: z.array(z.string().max(255)).max(32)
  })
  .partial()

const willPropertiesSchema = z
  .object({
    willDelayInterval: optional(uint32Schema),
    payloadFormatIndicator: optional(z.boolean()),
    messageExpiryInterval: optional(uint32Schema),
    contentType: optional(z.string().max(UINT16_MAX)),
    responseTopic: optional(z.string().max(UINT16_MAX)),
    correlationData: optional(z.string().max(UINT16_MAX)),
    userProperties: storedUserProperties
  })
  .partial()

const willSchema = z
  .object({
    enabled: z.boolean(),
    topic: z.string().max(UINT16_MAX),
    payload: z.string().max(UINT16_MAX * 64),
    qos: qosSchema,
    retain: z.boolean(),
    properties: willPropertiesSchema
  })
  .partial()

const connectPropertiesSchema = z
  .object({
    sessionExpiryInterval: optional(uint32Schema),
    receiveMaximum: optional(z.number().int().min(1).max(UINT16_MAX)),
    maximumPacketSize: optional(z.number().int().min(1).max(UINT32_MAX)),
    topicAliasMaximum: optional(uint16Schema),
    requestResponseInformation: optional(z.boolean()),
    requestProblemInformation: optional(z.boolean()),
    userProperties: storedUserProperties
  })
  .partial()

/** The lenient profile schema (files on disk); `strictConnectionProfileSchema` adds the rules. */
export const connectionProfileSchema = z
  .object({
    id: idSchema,
    name: z.string().max(256),
    color: z.string().max(64),
    group: z.string().max(256),
    protocol: z.enum(MQTT_PROTOCOLS, { error: 'Protocol must be mqtt, mqtts, ws or wss' }),
    host: z.string().max(1024),
    port: z.number().int().min(1, 'Port must be 1-65535').max(65535, 'Port must be 1-65535'),
    path: z.string().max(4096),
    clientId: z.string().max(UINT16_MAX),
    username: z.string().max(UINT16_MAX),
    password: z.string().max(UINT16_MAX),
    protocolVersion: protocolVersionSchema,
    clean: z.boolean(),
    keepalive: uint16Schema,
    connectTimeout: z.number().int().min(0).max(LIMITS.connectTimeoutMs.max),
    autoReconnect: z.boolean(),
    reconnectPeriod: z.number().int().min(0).max(LIMITS.reconnectPeriodMs.max),
    tls: tlsSchema,
    will: willSchema,
    properties: connectPropertiesSchema,
    subscriptions: z.array(storedSubscriptionSchema).max(10_000),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    lastConnectedAt: optional(timestampSchema)
  })
  .partial()

export type ConnectionProfileInput = z.output<typeof connectionProfileSchema>

type IssuePath = (string | number)[]

/** The strict rules (see the module comment), on a profile that passed the lenient schema. */
function checkStrictRules(profile: ConnectionProfileInput, ctx: z.RefinementCtx): void {
  const issue = (path: IssuePath, message: string): void => {
    ctx.addIssue({ code: 'custom', path, message })
  }
  const text = (value: string | undefined, path: IssuePath, label: string): void => {
    const problem = value === undefined ? null : mqttStringProblem(value)
    if (problem) issue(path, `${label} ${problem}`)
  }
  const binary = (value: string | undefined, path: IssuePath, label: string): void => {
    if (value !== undefined && utf8ByteLength(value) > MQTT_STRING_MAX_BYTES) {
      issue(path, `${label} is too long (max ${MQTT_STRING_MAX_BYTES} bytes)`)
    }
  }
  const topic = (value: string, path: IssuePath, label: string): void => {
    const problem = validateTopicName(value)
    if (problem) issue(path, problem)
    else text(value, path, label)
  }
  const userProperties = (list: UserProperty[] | undefined, path: IssuePath): void => {
    list?.forEach((property, i) => {
      text(property.key, [...path, i, 'key'], 'User property key')
      text(property.value, [...path, i, 'value'], 'User property value')
    })
  }

  const hostProblem = profile.host === undefined ? null : validateBrokerHost(profile.host)
  if (hostProblem) issue(['host'], hostProblem)
  const { min } = LIMITS.reconnectPeriodMs
  if ((profile.autoReconnect ?? true) && (profile.reconnectPeriod ?? min) < min) {
    issue(['reconnectPeriod'], `Reconnect period must be at least ${min} ms with auto reconnect on`)
  }
  text(profile.clientId, ['clientId'], 'Client ID')
  text(profile.username, ['username'], 'Username')
  binary(profile.password, ['password'], 'Password')
  profile.subscriptions?.forEach((sub, i) =>
    text(sub.topic, ['subscriptions', i, 'topic'], 'Topic filter')
  )

  const will = profile.will
  if (will) {
    if (will.enabled) topic(will.topic ?? '', ['will', 'topic'], 'Will topic')
    else text(will.topic, ['will', 'topic'], 'Will topic')
    binary(will.payload, ['will', 'payload'], 'Will payload')
    const props = will.properties
    text(props?.contentType, ['will', 'properties', 'contentType'], 'Will content type')
    if (props?.responseTopic) {
      topic(props.responseTopic, ['will', 'properties', 'responseTopic'], 'Will response topic')
    }
    binary(
      props?.correlationData,
      ['will', 'properties', 'correlationData'],
      'Will correlation data'
    )
    userProperties(props?.userProperties, ['will', 'properties', 'userProperties'])
  }
  userProperties(profile.properties?.userProperties, ['properties', 'userProperties'])
}

/** The profile schema of saves over IPC and imports (the connection form's rules). */
export const strictConnectionProfileSchema = connectionProfileSchema.superRefine(checkStrictRules)

/** Completes a validated (possibly partial) profile with defaults. */
export function completeConnectionProfile(input: ConnectionProfileInput): ConnectionProfile {
  // normalizeConnectionProfile deep-merges tls / will / properties over fresh defaults and
  // rebuilds every subscription through createSubscription, so nested partials are safe.
  return normalizeConnectionProfile(stripUndefined(input) as Partial<ConnectionProfile>)
}

export type SafeParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Validates + normalizes a profile without throwing. `mode`: 'strict' for anything a user or a
 * file hands in now (IPC saves, imports), 'lenient' for `connections.json` on load.
 */
export function safeParseConnectionProfile(
  input: unknown,
  mode: ProfileMode = 'strict'
): SafeParseResult<ConnectionProfile> {
  const schema = mode === 'strict' ? strictConnectionProfileSchema : connectionProfileSchema
  const result = schema.safeParse(input)
  if (!result.success) return { ok: false, error: formatIssues(result.error) }
  const profile = completeConnectionProfile(result.data)
  // The form trims the host; imports may not have (a padded host is no valid URL).
  if (mode === 'strict') profile.host = profile.host.trim()
  return { ok: true, value: profile }
}

/** Validates (strictly) + normalizes a profile; throws `Error("Invalid connection profile: …")`. */
export function parseConnectionProfile(input: unknown): ConnectionProfile {
  const result = safeParseConnectionProfile(input, 'strict')
  if (!result.ok) throw new Error(`Invalid connection profile: ${result.error}`)
  return result.value
}

/** Validates a live subscription (valid filter required) and fills missing options. */
export function parseSubscription(input: unknown): Subscription {
  const result = liveSubscriptionSchema.safeParse(input)
  if (!result.success) throw new Error(`Invalid subscription: ${formatIssues(result.error)}`)
  return createSubscription(stripUndefined(result.data))
}
