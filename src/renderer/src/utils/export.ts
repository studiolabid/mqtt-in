/**
 * Message export to JSON / CSV (pure, no Vue).
 */
import type {
  MessageDirection,
  MessageProperties,
  MqttMessage,
  PayloadFormat,
  QoS,
  ViewFormat
} from '@shared/models'
import { decodePayload, toBase64 } from '@shared/payload'

/** One exported message. `payloadBase64` always holds the exact bytes. */
export interface ExportedMessage {
  direction: MessageDirection
  topic: string
  qos: QoS
  retain: boolean
  /** ISO-8601 (UTC). */
  timestamp: string
  /** Payload decoded with the requested view format (falls back to auto detection). */
  payload: string
  /** The format `payload` is written in. */
  payloadEncoding: PayloadFormat
  payloadBase64: string
  properties?: MessageProperties
}

export interface CsvOptions {
  /** Prepend a UTF-8 byte order mark (helps Excel detect the encoding). Default false. */
  bom?: boolean
}

const CSV_COLUMNS = [
  'timestamp',
  'direction',
  'topic',
  'qos',
  'retain',
  'payload_encoding',
  'payload',
  'payload_base64',
  'properties'
] as const

/** Converts a message into its export record. */
export function toExportedMessage(message: MqttMessage, format: ViewFormat): ExportedMessage {
  let decoded = decodePayload(message.payload, format, { pretty: false })
  // A forced format that does not fit the bytes yields a fallback text: describe it honestly.
  if (decoded.error) decoded = decodePayload(message.payload, 'auto', { pretty: false })
  const record: ExportedMessage = {
    direction: message.direction,
    topic: message.topic,
    qos: message.qos,
    retain: message.retain,
    timestamp: new Date(message.timestamp).toISOString(),
    payload: decoded.text,
    payloadEncoding: decoded.format,
    payloadBase64: toBase64(message.payload)
  }
  if (message.properties && Object.keys(message.properties).length > 0) {
    record.properties = message.properties
  }
  return record
}

/** Pretty-printed JSON array of `ExportedMessage`s (chronological as given). */
export function messagesToJson(messages: readonly MqttMessage[], format: ViewFormat): string {
  return JSON.stringify(
    messages.map((message) => toExportedMessage(message, format)),
    null,
    2
  )
}

/**
 * RFC 4180 CSV with a header row and CRLF line breaks. Text cells that would be evaluated as
 * spreadsheet formulas (`=`, `+`, `-`, `@` followed by non-numeric text) are prefixed with `'`;
 * the exact bytes stay available in `payload_base64`.
 */
export function messagesToCsv(
  messages: readonly MqttMessage[],
  format: ViewFormat,
  options: CsvOptions = {}
): string {
  const lines: string[] = [CSV_COLUMNS.join(',')]
  for (const message of messages) {
    const record = toExportedMessage(message, format)
    const cells = [
      record.timestamp,
      record.direction,
      safeText(record.topic),
      String(record.qos),
      record.retain ? 'true' : 'false',
      record.payloadEncoding,
      safeText(record.payload),
      record.payloadBase64,
      record.properties ? safeText(JSON.stringify(record.properties)) : ''
    ]
    lines.push(cells.map(csvCell).join(','))
  }
  return `${options.bom ? '﻿' : ''}${lines.join('\r\n')}\r\n`
}

/**
 * Safe, readable file name for an export, e.g. `home-broker-2026-11-08-153012.csv`.
 * Characters that are invalid on Windows / macOS / Linux are removed.
 */
export function exportFileName(connectionName: string, ext: string, now = new Date()): string {
  const base =
    connectionName
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 60)
      .replace(/[-.]+$/g, '') || 'mqtt-in'
  const extension =
    ext
      .replace(/^\.+/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') || 'txt'
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${base}-${stamp}.${extension}`
}

const FORMULA_START = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

/** Neutralizes spreadsheet formula injection without touching plain numbers. */
function safeText(value: string): string {
  return FORMULA_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
