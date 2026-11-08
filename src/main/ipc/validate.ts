/**
 * Validation of every value received over IPC. Each `parse*` returns a typed value
 * or throws an `Error` with a short, human message.
 */
import { z } from 'zod'
import { LIMITS } from '@shared/defaults'
import type {
  ExportConnectionsOptions,
  FileFilter,
  PickFileOptions,
  PublishRequest,
  RepeatPublishOptions,
  SaveFileOptions,
  ThemeMode
} from '@shared/models'
import {
  parseWith,
  publishPropertiesSchema,
  qosSchema,
  topicNameSchema,
  VARINT_MAX
} from '../schemas/common'
import { PAYLOAD_FORMATS, THEME_MODES } from '../schemas/enums'
import { assertRepeatOptions } from '../services/mqtt/repeat-job'
import { errorMessage } from '../utils/errors'

export { parseConnectionProfile, parseSubscription } from '../schemas/profile'
export { parseSettingsPatch } from '../schemas/settings'

const idSchema = z.string().min(1, 'id is required').max(128)

/** A connection / job id. */
export function parseId(input: unknown, label = 'id'): string {
  return parseWith(idSchema, input, label)
}

/** A list of ids (`reorder`). */
export function parseIds(input: unknown): string[] {
  return parseWith(z.array(idSchema).max(10_000), input, 'id list')
}

/** An optional list of ids (`exportToFile`); `undefined` / `null` = all. */
export function parseOptionalIds(input: unknown): string[] | undefined {
  return input === undefined || input === null ? undefined : parseIds(input)
}

const exportOptionsSchema = z.strictObject({ includeSecrets: z.boolean().optional() })

/** Options of `connections.exportToFile` (`undefined` / `null` = defaults; unknown keys fail). */
export function parseExportOptions(input: unknown): ExportConnectionsOptions {
  if (input === undefined || input === null) return {}
  return parseWith(exportOptionsSchema, input, 'export options')
}

/** Windows' longest path (`\\?\` form); longer strings are never a file of ours. */
const MAX_PATH_LENGTH = 32_767

/** A file path sent back by the renderer (`app.showItemInFolder`); not checked against disk. */
export function parseFilePath(input: unknown): string {
  return parseWith(z.string().min(1).max(MAX_PATH_LENGTH), input, 'file path')
}

const payloadSchema = z
  .instanceof(Uint8Array, { error: 'Payload must be bytes (Uint8Array)' })
  .refine((bytes) => bytes.byteLength <= VARINT_MAX, 'Payload is too large (max 256 MB)')

const publishRequestSchema = z.object({
  topic: topicNameSchema,
  payload: payloadSchema,
  qos: qosSchema,
  retain: z.boolean(),
  properties: publishPropertiesSchema.optional()
})

export function parsePublishRequest(input: unknown): PublishRequest {
  return parseWith(publishRequestSchema, input, 'publish request')
}

const { min: minInterval, max: maxInterval } = LIMITS.repeatIntervalMs

const repeatOptionsSchema = z.object({
  topic: topicNameSchema,
  payload: z.string().max(16 * 1024 * 1024),
  format: z.enum(PAYLOAD_FORMATS),
  useTemplate: z.boolean().optional(),
  qos: qosSchema,
  retain: z.boolean(),
  properties: publishPropertiesSchema.optional(),
  intervalMs: z
    .number()
    .min(minInterval, `Interval must be at least ${minInterval} ms`)
    .max(maxInterval, 'Interval must be at most 24 h')
    .transform(Math.round),
  count: z.number().int('Count must be a whole number').min(0).max(Number.MAX_SAFE_INTEGER)
})

/** Repeat options; the payload must render and encode (checked once up front). */
export function parseRepeatOptions(input: unknown): RepeatPublishOptions {
  const options = parseWith(repeatOptionsSchema, input, 'repeat options')
  try {
    assertRepeatOptions(options)
  } catch (err) {
    throw new Error(`Invalid repeat payload: ${errorMessage(err)}`, { cause: err })
  }
  return options
}

const storageKeySchema = z
  .string()
  .regex(/^[\w.:-]{1,128}$/, 'Keys are 1-128 characters: letters, digits, _ . : -')
  .refine((key) => key !== '__proto__', 'Reserved key')

export function parseStorageKey(input: unknown): string {
  return parseWith(storageKeySchema, input, 'storage key')
}

export function parseThemeMode(input: unknown): ThemeMode {
  return parseWith(z.enum(THEME_MODES), input, 'theme')
}

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** An http(s) / mailto URL (normalized). */
export function parseExternalUrl(input: unknown): string {
  const text = parseWith(z.string().min(1).max(8192), input, 'URL')
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error('Invalid URL')
  }
  if (!EXTERNAL_PROTOCOLS.has(url.protocol)) {
    throw new Error('Only http, https and mailto links can be opened')
  }
  return url.toString()
}

const fileFilterSchema: z.ZodType<FileFilter> = z.object({
  name: z.string().max(128),
  extensions: z.array(z.string().regex(/^(\*|[\w.-]{1,32})$/, 'Invalid file extension')).max(32)
})

const pickFileOptionsSchema = z.object({
  title: z.string().max(256).optional(),
  filters: z.array(fileFilterSchema).max(16).optional()
})

/** Options of `pickFile` / `openFile` (`undefined` = defaults). */
export function parsePickFileOptions(input: unknown): PickFileOptions {
  if (input === undefined || input === null) return {}
  return parseWith(pickFileOptionsSchema, input, 'file dialog options')
}

const saveFileOptionsSchema = z.object({
  title: z.string().max(256).optional(),
  defaultPath: z.string().max(4096).optional(),
  filters: z.array(fileFilterSchema).max(16).optional(),
  content: z.union([z.string(), z.instanceof(Uint8Array)], {
    error: 'Content must be a string or bytes'
  })
})

export function parseSaveFileOptions(input: unknown): SaveFileOptions {
  return parseWith(saveFileOptionsSchema, input, 'save options')
}
