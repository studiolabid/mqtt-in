/**
 * WebSocket and Socket.IO in the connection dialog: the shared kind helpers, switching kinds
 * (protocol, path and socket settings follow), the sections each kind shows, the form rules
 * (same verdict as the main-process schema), and the CLI commands that stay MQTT-only.
 */
import { describe, expect, it } from 'vitest'
import {
  connectionKind,
  headerProblem,
  normalizeNamespace,
  parseSocketAuth,
  parseSubprotocols,
  protocolForKind,
  socketSettings,
  websocketTopic,
  WS_MESSAGE_TOPIC
} from '@shared/connection-kind'
import { createConnectionProfile, normalizeConnectionProfile } from '@shared/defaults'
import type { ConnectionProfile } from '@shared/models'
import { createConnectionForm } from '@/features/connections/composables/useConnectionForm'
import { sectionsFor } from '@/features/connections/utils/sections'
import { firstInvalidSection, validateConnection } from '@/features/connections/utils/validate'
import { publishCommand } from '@/utils/cli-command'
import { safeParseConnectionProfile } from '../../../../src/main/schemas/profile'

function socketProfile(
  kind: 'websocket' | 'socketio',
  patch: Partial<ConnectionProfile['socket']> = {}
): ConnectionProfile {
  return createConnectionProfile({
    kind,
    name: 'Feed',
    host: 'feed.local',
    port: 3000,
    protocol: 'ws',
    path: '/',
    socket: { ...socketSettings({}), ...patch }
  })
}

describe('connection kind helpers', () => {
  it('reads old profiles as MQTT and fills in the socket defaults', () => {
    expect(connectionKind({})).toBe('mqtt')
    expect(socketSettings({})).toEqual({
      headers: [],
      subprotocols: '',
      namespace: '/',
      auth: '',
      topicField: ''
    })
    expect(normalizeConnectionProfile({ host: 'a' }).socket).toBeUndefined()
    // A partial `socket` from an older or hand-written file.
    const partial = JSON.parse('{"socket":{"auth":"{}"}}') as Partial<ConnectionProfile>
    expect(normalizeConnectionProfile(partial).socket).toMatchObject({
      auth: '{}',
      headers: []
    })
  })

  it('maps protocols, namespaces, subprotocols and auth', () => {
    expect(protocolForKind('socketio', 'mqtts')).toBe('wss')
    expect(protocolForKind('websocket', 'mqtt')).toBe('ws')
    expect(protocolForKind('mqtt', 'mqtts')).toBe('mqtts')
    expect(normalizeNamespace('admin')).toBe('/admin')
    expect(normalizeNamespace(' ')).toBe('/')
    expect(parseSubprotocols(' json, ,v2 ')).toEqual(['json', 'v2'])
    expect(parseSocketAuth('')).toBeUndefined()
    expect(parseSocketAuth('{"token":"x"}')).toEqual({ token: 'x' })
    expect(() => parseSocketAuth('[1]')).toThrow(/JSON object/)
    expect(() => parseSocketAuth('{token}')).toThrow(/JSON object/)
    expect(headerProblem('X-Token', 'abc')).toBeNull()
    expect(headerProblem('Bad Header', 'abc')).toMatch(/invalid characters/)
    expect(headerProblem('X-Token', 'a\nb')).toMatch(/single line/)
  })

  it('takes a WebSocket topic from the configured JSON field', () => {
    expect(websocketTopic('{"type":"temp","v":1}', 'type')).toBe('temp')
    expect(websocketTopic('{"channel":7}', 'channel')).toBe('7')
    expect(websocketTopic('{"type":""}', 'type')).toBe(WS_MESSAGE_TOPIC)
    expect(websocketTopic('{"type":"temp"}', '')).toBe(WS_MESSAGE_TOPIC)
    expect(websocketTopic('not json', 'type')).toBe(WS_MESSAGE_TOPIC)
    expect(websocketTopic(null, 'type')).toBe(WS_MESSAGE_TOPIC)
  })
})

describe('switching the kind in the dialog', () => {
  function form(): ReturnType<typeof createConnectionForm> {
    const created = createConnectionForm({ onSubmit: () => {}, groupNames: () => [] })
    created.reset(createConnectionProfile({ name: 'Lab', host: 'broker.local' }), 'create')
    return created
  }

  it('moves protocol, port and path along, and back', () => {
    const f = form()
    f.setKind('socketio')
    expect(f.draft.value).toMatchObject({
      kind: 'socketio',
      protocol: 'ws',
      port: 8083,
      path: '/socket.io/'
    })
    expect(f.draft.value.socket?.namespace).toBe('/')
    f.setKind('websocket')
    expect(f.draft.value.path).toBe('/')
    f.draft.value.path = '/live'
    f.setKind('socketio')
    expect(f.draft.value.path).toBe('/live')
    f.setKind('mqtt')
    expect(f.draft.value.protocol).toBe('ws')
  })

  it('builds clean socket settings', () => {
    const f = form()
    f.setKind('websocket')
    const socket = f.draft.value.socket
    if (!socket) throw new Error('no socket settings')
    socket.headers = [
      { key: ' Authorization ', value: 'Bearer x' },
      { key: '', value: '' }
    ]
    socket.topicField = ' type '
    const built = f.build()
    expect(built.socket?.headers).toEqual([{ key: 'Authorization', value: 'Bearer x' }])
    expect(built.socket?.topicField).toBe('type')
  })

  it('shows the sections of the kind', () => {
    const ids = (kind: 'mqtt' | 'websocket' | 'socketio'): string[] =>
      sectionsFor(kind).map((section) => section.id)
    expect(ids('mqtt')).toEqual(['general', 'auth', 'tls', 'advanced', 'will', 'mqtt5'])
    expect(ids('websocket')).toEqual(['general', 'socket', 'tls', 'advanced'])
    expect(ids('socketio')).toEqual(['general', 'socket', 'tls', 'advanced'])
  })
})

describe('socket rules (form and main process agree)', () => {
  const cases: ReadonlyArray<[string, ConnectionProfile, boolean]> = [
    ['a plain WebSocket profile', socketProfile('websocket'), true],
    [
      'a header name with a space',
      socketProfile('websocket', { headers: [{ key: 'Bad Header', value: 'x' }] }),
      false
    ],
    ['an invalid subprotocol', socketProfile('websocket', { subprotocols: 'a b' }), false],
    ['auth that is not JSON', socketProfile('socketio', { auth: 'token=1' }), false],
    ['an auth object', socketProfile('socketio', { auth: '{"token":"1"}' }), true],
    // Auth is a Socket.IO option: a WebSocket profile keeps whatever it holds.
    ['auth text on a WebSocket profile', socketProfile('websocket', { auth: 'x' }), true]
  ]

  it.each(cases)('%s', (_name, profile, valid) => {
    const errors = validateConnection(profile)
    expect(Object.keys(errors).length === 0).toBe(valid)
    expect(safeParseConnectionProfile(profile).ok).toBe(valid)
    if (!valid) expect(firstInvalidSection(errors)).toBe('socket')
  })

  it('skips the MQTT-only fields and refuses mqtt:// for sockets in the main process', () => {
    const profile = socketProfile('websocket')
    profile.clientId = '\ud800' // an unpaired surrogate would fail the MQTT string rule
    expect(validateConnection(profile)).toEqual({})
    const parsed = safeParseConnectionProfile({ ...socketProfile('socketio'), protocol: 'mqtt' })
    expect(parsed.ok).toBe(false)
  })

  it('offers no command line for socket connections', () => {
    const result = publishCommand(
      {
        profile: socketProfile('socketio'),
        topic: 'cmd',
        payload: new Uint8Array([49]),
        qos: 0,
        retain: false
      },
      'mqttx',
      'posix'
    )
    expect(result).toEqual({ ok: false, error: 'Command line tools are only for MQTT connections' })
  })
})
