/**
 * Shared zod building blocks and helpers for validating data that enters the
 * main process (IPC requests, files on disk, imports).
 *
 * MQTT limits strings to 65,535 UTF-8 *bytes* (a two-byte length prefix), not characters: one
 * '€' is 3 bytes. mqtt-packet throws in the middle of a packet for a longer string, which leaves
 * a broken packet on the socket, so every MQTT string is checked in bytes (`mqttStringSchema`,
 * `mqttBinarySchema`) before it can reach a session.
 */
import { z } from 'zod'
import { MQTT_STRING_MAX_BYTES, mqttStringProblem, utf8ByteLength } from '@shared/mqtt-string'
import { validateTopicFilter, validateTopicName } from '@shared/topic'

export const UINT16_MAX = 0xffff
export const UINT32_MAX = 0xffffffff
/** Largest MQTT variable byte integer (subscription identifiers, packet sizes). */
export const VARINT_MAX = 268_435_455

/** Treats `null`, `''` and `NaN` (typical values of cleared form inputs) as "not set". */
function emptyToUndefined(value: unknown): unknown {
  if (value === null || value === '') return undefined
  if (typeof value === 'number' && Number.isNaN(value)) return undefined
  return value
}

/** An optional field that also accepts `null` / `''` / `NaN` as "not set". */
export function optional<T extends z.ZodType>(schema: T): z.ZodPreprocess<z.ZodOptional<T>> {
  return z.preprocess(emptyToUndefined, schema.optional())
}

/**
 * An MQTT UTF-8 string: at most 65,535 bytes and no unpaired surrogate. `label` starts the
 * message, e.g. 'Client ID is too long (max 65535 bytes)'.
 */
export function mqttStringSchema(label: string): z.ZodString {
  return z.string().superRefine((value, ctx) => {
    const problem = mqttStringProblem(value)
    if (problem) ctx.addIssue({ code: 'custom', message: `${label} ${problem}` })
  })
}

/** Binary data sent as UTF-8 (password, correlation data, will payload): at most 65,535 bytes. */
export function mqttBinarySchema(label: string): z.ZodString {
  return z.string().superRefine((value, ctx) => {
    if (value.length > MQTT_STRING_MAX_BYTES || utf8ByteLength(value) > MQTT_STRING_MAX_BYTES) {
      ctx.addIssue({ code: 'custom', message: `${label} is too long (max 65535 bytes)` })
    }
  })
}

export const qosSchema = z.union([z.literal(0), z.literal(1), z.literal(2)], {
  error: 'QoS must be 0, 1 or 2'
})

export const uint16Schema = z.number().int().min(0).max(UINT16_MAX)
export const uint32Schema = z.number().int().min(0).max(UINT32_MAX)
export const timestampSchema = z.number().int().min(0)

type UserPropertiesSchema = z.ZodArray<z.ZodObject<{ key: z.ZodString; value: z.ZodString }>>

/**
 * MQTT 5 user properties (at most 1024 pairs). `strict`: every key and value is checked as an
 * MQTT string; otherwise (connection files on disk, which must keep loading) only the old
 * character limit applies.
 */
export function userPropertiesSchemaFor(strict: boolean): UserPropertiesSchema {
  const property = strict
    ? z.object({
        key: mqttStringSchema('User property key'),
        value: mqttStringSchema('User property value')
      })
    : z.object({ key: z.string().max(UINT16_MAX), value: z.string().max(UINT16_MAX) })
  return z.array(property).max(1024)
}

/** User properties sent now (publish requests): checked as MQTT strings. */
export const userPropertiesSchema = userPropertiesSchemaFor(true)

/** A topic name usable for publishing (no wildcards). */
export const topicNameSchema = z.string().superRefine((topic, ctx) => {
  const problem = validateTopicName(topic)
  if (problem) ctx.addIssue({ code: 'custom', message: problem })
})

/** A topic filter usable for subscribing (wildcards and `$share/` allowed). */
export const topicFilterSchema = z.string().superRefine((filter, ctx) => {
  const problem = validateTopicFilter(filter)
  if (problem) ctx.addIssue({ code: 'custom', message: problem })
})

/** An optional response topic (MQTT 5): empty, or a topic name that is also an MQTT string. */
export function responseTopicSchema(label: string): z.ZodString {
  return z.string().superRefine((topic, ctx) => {
    if (topic.length === 0) return
    const problem = validateTopicName(topic)
    const encoding = problem ? null : mqttStringProblem(topic)
    if (problem) ctx.addIssue({ code: 'custom', message: `${label}: ${problem}` })
    else if (encoding) ctx.addIssue({ code: 'custom', message: `${label} ${encoding}` })
  })
}

/** MQTT 5 PUBLISH properties sent by the client (`PublishProperties`). */
export const publishPropertiesSchema = z.object({
  payloadFormatIndicator: optional(z.boolean()),
  messageExpiryInterval: optional(uint32Schema),
  topicAlias: optional(z.number().int().min(1).max(UINT16_MAX)),
  responseTopic: optional(responseTopicSchema('Response topic')),
  correlationData: optional(mqttBinarySchema('Correlation data')),
  contentType: optional(mqttStringSchema('Content type')),
  userProperties: optional(userPropertiesSchema)
})

/** Human summary of the first few validation issues: `port: Too big…; host: …`. */
export function formatIssues(error: z.ZodError, max = 3): string {
  return error.issues
    .slice(0, max)
    .map((issue) => {
      const path = issue.path.map(String).join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
}

/**
 * Parses `input` with `schema`, throwing `Error("Invalid <label>: <issues>")` on failure.
 * The result has `undefined`-valued properties removed (see `stripUndefined`).
 */
export function parseWith<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input)
  if (!result.success) throw new Error(`Invalid ${label}: ${formatIssues(result.error)}`)
  return stripUndefined(result.data)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Recursively removes `undefined`-valued properties from plain objects (arrays are
 * mapped, other values returned as-is) so `{ ...defaults, ...input }` merges never
 * overwrite a default with `undefined`.
 */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item: unknown) => stripUndefined(item)) as T
  if (!isPlainObject(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined && key !== '__proto__') out[key] = stripUndefined(item)
  }
  return out as T
}
