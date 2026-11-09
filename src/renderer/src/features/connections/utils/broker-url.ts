/**
 * "Paste magic" for the host field: splits a broker URL such as
 * `mqtts://user:pass@broker.example.com:8883` (or a bare `host:port`) into profile fields.
 * `http(s)://` URLs (Socket.IO servers) become `ws(s)://`; a WebSocket URL keeps its query.
 */
import type { MqttProtocol } from '@shared/models'
import { DEFAULT_PORTS } from '@shared/defaults'

export interface ParsedBrokerUrl {
  /** Missing for a bare `host:port`. */
  protocol?: MqttProtocol
  host: string
  port: number
  /** WebSocket path; only for ws / wss URLs that name one. */
  path?: string
  username?: string
  password?: string
}

/** Schemes accepted when pasting (common aliases from other clients included). */
const SCHEMES: Readonly<Record<string, MqttProtocol>> = {
  mqtt: 'mqtt',
  tcp: 'mqtt',
  mqtts: 'mqtts',
  ssl: 'mqtts',
  tls: 'mqtts',
  'mqtt+ssl': 'mqtts',
  ws: 'ws',
  wss: 'wss',
  // Socket.IO servers are usually given as http(s) URLs; they speak WebSocket on the same port.
  http: 'ws',
  https: 'wss'
}

const SCHEME = /^([a-z][a-z\d+.-]*):\/\//i
/** `host:port`, `1.2.3.4:1883` or `[::1]:1883`. */
const HOST_PORT = /^(\[[\da-f:.]+\]|[^\s:/[\]@?#]+):(\d{1,5})$/i

function unbracket(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/**
 * ws / wss are "special" URL schemes: the URL API drops their default ports (80 / 443), so an
 * empty port means exactly those. mqtt(s) URLs without a port use the MQTT defaults.
 */
function impliedPort(protocol: MqttProtocol): number {
  if (protocol === 'ws') return 80
  if (protocol === 'wss') return 443
  return DEFAULT_PORTS[protocol]
}

function validPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535
}

/** Parses pasted text; `null` when it is not a broker URL (paste it as plain text then). */
export function parseBrokerUrl(text: string): ParsedBrokerUrl | null {
  const input = text.trim()
  if (input === '' || /\s/.test(input)) return null

  const scheme = SCHEME.exec(input)
  if (!scheme) {
    const match = HOST_PORT.exec(input)
    if (!match) return null
    const port = Number(match[2])
    return validPort(port) ? { host: unbracket(match[1]), port } : null
  }

  const protocol = SCHEMES[scheme[1].toLowerCase()]
  if (!protocol) return null
  let url: URL
  try {
    // Aliases are rewritten so the URL API applies the right (special / non-special) rules.
    url = new URL(protocol + input.slice(scheme[1].length))
  } catch {
    return null
  }
  const host = unbracket(url.hostname)
  if (host === '') return null
  const port = url.port === '' ? impliedPort(protocol) : Number(url.port)
  if (!validPort(port)) return null

  const parsed: ParsedBrokerUrl = { protocol, host, port }
  if (protocol === 'ws' || protocol === 'wss') {
    // The query belongs to the WebSocket URL (e.g. `?token=…`).
    const path = url.pathname + url.search
    if (path !== '' && path !== '/') parsed.path = path
  }
  if (url.username !== '') parsed.username = decode(url.username)
  if (url.password !== '') parsed.password = decode(url.password)
  return parsed
}
