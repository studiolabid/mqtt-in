import { describe, expect, it } from 'vitest'
import type { ConnectionProfile } from '@shared/models'
import { createConnectionProfile, createSubscription } from '@shared/defaults'
import {
  defaultCliShell,
  MAX_COMMAND_LENGTH,
  publishCommand,
  quoteArgument,
  subscribeCommand,
  type CliResult,
  type PublishCommandInput
} from '@/utils/cli-command'
import { utf8 } from './helpers'

function profile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return createConnectionProfile({
    host: 'broker.example.com',
    port: 1883,
    clientId: 'mqttin_0a1b2c3d',
    ...overrides
  })
}

function publish(overrides: Partial<PublishCommandInput> = {}): PublishCommandInput {
  return {
    profile: profile(),
    topic: 'home/temp',
    payload: utf8('21.5'),
    qos: 0,
    retain: false,
    ...overrides
  }
}

function command(result: CliResult): string {
  if (!result.ok) throw new Error(result.error)
  return result.command
}

describe('quoting per shell', () => {
  const tricky = `it's "quoted" $HOME \`cmd\` \\ back\nnew line ‘curly’ €`

  it("POSIX: single quotes with '\\'' escapes, newlines kept", () => {
    expect(quoteArgument(tricky, 'posix')).toMatchInlineSnapshot(`
      "'it'\\''s "quoted" $HOME \`cmd\` \\ back
      new line ‘curly’ €'"
    `)
    expect(quoteArgument('plain/topic-1.x', 'posix')).toBe('plain/topic-1.x')
    expect(quoteArgument('a/#', 'posix')).toBe("'a/#'")
    expect(quoteArgument('', 'posix')).toBe("''")
  })

  it("PowerShell: single quotes with '' escapes (typographic quotes too), newlines kept", () => {
    expect(quoteArgument(tricky, 'powershell')).toMatchInlineSnapshot(`
      "'it''s "quoted" $HOME \`cmd\` \\ back
      new line ‘‘curly’’ €'"
    `)
    expect(quoteArgument('$SYS/#', 'powershell')).toBe("'$SYS/#'")
    expect(quoteArgument('a,b', 'powershell')).toBe("'a,b'")
  })

  it('picks the shell of the platform', () => {
    expect(defaultCliShell('win32')).toBe('powershell')
    expect(defaultCliShell('darwin')).toBe('posix')
    expect(defaultCliShell('linux')).toBe('posix')
  })
})

describe('publishCommand', () => {
  it('builds a mosquitto_pub command (generated client id omitted)', () => {
    expect(command(publishCommand(publish(), 'mosquitto_pub', 'posix'))).toMatchInlineSnapshot(
      `"mosquitto_pub -h broker.example.com -p 1883 -V mqttv5 -t home/temp -m 21.5"`
    )
    expect(command(publishCommand(publish(), 'mqttx', 'posix'))).toMatchInlineSnapshot(
      `"mqttx pub -h broker.example.com -p 1883 -V 5 -t home/temp -m 21.5"`
    )
  })

  it('quotes payloads with quotes, $, backticks, newlines and unicode', () => {
    const payload = utf8(`{"msg": "it's $5 \`now\`",\n "t": "€"}`)
    const input = publish({ payload, qos: 1, retain: true })
    expect(command(publishCommand(input, 'mosquitto_pub', 'posix'))).toMatchInlineSnapshot(`
      "mosquitto_pub -h broker.example.com -p 1883 -V mqttv5 -t home/temp -q 1 -r -m '{"msg": "it'\\''s $5 \`now\`",
       "t": "€"}'"
    `)
    const ps = publishCommand(input, 'mosquitto_pub', 'powershell')
    expect(command(ps)).toMatchInlineSnapshot(`
      "mosquitto_pub -h broker.example.com -p 1883 -V mqttv5 -t home/temp -q 1 -r -m '{"msg": "it''s $5 \`now\`",
       "t": "€"}'"
    `)
    expect(ps.ok && ps.warning).toContain('PowerShell 7.3')
  })

  it('never inlines the password; uses an environment variable per shell', () => {
    const secret = profile({
      username: 'alice',
      password: 'hunter2-SECRET',
      clientId: 'plant-gw-1'
    })
    const posix = publishCommand(publish({ profile: secret }), 'mosquitto_pub', 'posix')
    const ps = publishCommand(publish({ profile: secret }), 'mqttx', 'powershell')
    expect(command(posix)).toMatchInlineSnapshot(
      `"mosquitto_pub -h broker.example.com -p 1883 -V mqttv5 -i plant-gw-1 -u alice -P "$MQTT_PASSWORD" -t home/temp -m 21.5"`
    )
    expect(command(ps)).toMatchInlineSnapshot(
      `"mqttx pub -h broker.example.com -p 1883 -V 5 -i plant-gw-1 -u alice -P $env:MQTT_PASSWORD -t home/temp -m 21.5"`
    )
    for (const result of [posix, ps]) {
      expect(command(result)).not.toContain('hunter2')
      expect(result.ok && result.passwordVariable).toBe('MQTT_PASSWORD')
    }
    expect(publishCommand(publish(), 'mqttx', 'posix')).not.toHaveProperty('passwordVariable')
  })

  it('adds TLS flags (CA, client certificate, insecure, ALPN)', () => {
    const tls = profile({
      protocol: 'mqtts',
      port: 8883,
      tls: {
        rejectUnauthorized: false,
        caPath: 'C:\\certs\\ca.pem',
        certPath: '/etc/mqtt/client.crt',
        keyPath: '/etc/mqtt/client.key',
        passphrase: 'never-printed',
        servername: '',
        alpnProtocols: ['x-amzn-mqtt-ca']
      }
    })
    const mosquitto = command(publishCommand(publish({ profile: tls }), 'mosquitto_pub', 'posix'))
    expect(mosquitto).toMatchInlineSnapshot(
      `"mosquitto_pub -h broker.example.com -p 8883 -V mqttv5 --cafile 'C:\\certs\\ca.pem' --cert /etc/mqtt/client.crt --key /etc/mqtt/client.key --insecure --tls-alpn x-amzn-mqtt-ca -t home/temp -m 21.5"`
    )
    expect(
      command(publishCommand(publish({ profile: tls }), 'mqttx', 'posix'))
    ).toMatchInlineSnapshot(
      `"mqttx pub -h broker.example.com -p 8883 -l mqtts -V 5 --ca 'C:\\certs\\ca.pem' --cert /etc/mqtt/client.crt --key /etc/mqtt/client.key --insecure --alpn x-amzn-mqtt-ca -t home/temp -m 21.5"`
    )
    expect(mosquitto).not.toContain('never-printed')
    // System CAs: mosquitto only enables TLS with a CA option.
    const system = profile({ protocol: 'mqtts', port: 8883 })
    expect(
      command(publishCommand(publish({ profile: system }), 'mosquitto_pub', 'posix'))
    ).toContain('--tls-use-os-certs')
  })

  it('adds MQTT 5 properties (user properties, content type, response topic, correlation, expiry)', () => {
    const input = publish({
      properties: {
        contentType: 'application/json',
        responseTopic: 'reply/to',
        correlationData: 'req-42',
        messageExpiryInterval: 60,
        payloadFormatIndicator: true,
        topicAlias: 3,
        userProperties: [
          { key: 'source', value: 'mqtt-in cli' },
          { key: 'id', value: "it's" }
        ]
      }
    })
    expect(command(publishCommand(input, 'mosquitto_pub', 'posix'))).toMatchInlineSnapshot(
      `"mosquitto_pub -h broker.example.com -p 1883 -V mqttv5 -t home/temp -D publish payload-format-indicator 1 -D publish message-expiry-interval 60 -D publish content-type application/json -D publish response-topic reply/to -D publish correlation-data req-42 -D publish user-property source 'mqtt-in cli' -D publish user-property id 'it'\\''s' -m 21.5"`
    )
    expect(command(publishCommand(input, 'mqttx', 'powershell'))).toMatchInlineSnapshot(
      `"mqttx pub -h broker.example.com -p 1883 -V 5 -t home/temp -pf -e 60 -ct application/json -rt reply/to -cd req-42 -up 'source: mqtt-in cli' -up 'id: it''s' -m 21.5"`
    )
    // MQTT 3.1.1 profiles send no properties.
    const v4 = { ...input, profile: profile({ protocolVersion: 4 }) }
    expect(command(publishCommand(v4, 'mosquitto_pub', 'posix'))).toMatchInlineSnapshot(
      `"mosquitto_pub -h broker.example.com -p 1883 -V mqttv311 -t home/temp -m 21.5"`
    )
  })

  it('sends an empty payload with -n (mosquitto) or an empty message (MQTTX)', () => {
    const empty = publish({ payload: new Uint8Array(0), retain: true })
    expect(command(publishCommand(empty, 'mosquitto_pub', 'posix'))).toMatch(/ -r -n$/)
    expect(command(publishCommand(empty, 'mqttx', 'posix'))).toMatch(/ -r -m ''$/)
  })

  it('refuses mosquitto over WebSockets (MQTTX works)', () => {
    const ws = profile({ protocol: 'wss', port: 8084, path: '/mqtt' })
    expect(publishCommand(publish({ profile: ws }), 'mosquitto_pub', 'posix')).toEqual({
      ok: false,
      error: 'mosquitto_pub cannot connect over WebSockets: copy the MQTTX command instead'
    })
    expect(
      command(publishCommand(publish({ profile: ws }), 'mqttx', 'posix'))
    ).toMatchInlineSnapshot(
      `"mqttx pub -h broker.example.com -p 8084 -l wss --path /mqtt -V 5 -t home/temp -m 21.5"`
    )
  })

  it('refuses binary payloads, NUL characters, MQTTX-incompatible user properties and huge commands', () => {
    const binary = publish({ payload: new Uint8Array([0xff, 0xfe, 0x00]) })
    expect(publishCommand(binary, 'mosquitto_pub', 'posix')).toEqual({
      ok: false,
      error: 'Binary payloads cannot be copied as a command yet'
    })
    expect(publishCommand(publish({ payload: utf8('a\u0000b') }), 'mqttx', 'posix').ok).toBe(false)
    const colon = publish({ properties: { userProperties: [{ key: 'a: b', value: 'c' }] } })
    expect(publishCommand(colon, 'mqttx', 'posix').ok).toBe(false)
    expect(publishCommand(colon, 'mosquitto_pub', 'posix').ok).toBe(true)
    const huge = publish({ payload: utf8('x'.repeat(MAX_COMMAND_LENGTH)) })
    expect(publishCommand(huge, 'mosquitto_pub', 'posix')).toEqual({
      ok: false,
      error: 'The message is too large to copy as a command'
    })
  })

  it('maps the protocol versions', () => {
    for (const [protocolVersion, mosquitto, mqttx] of [
      [3, 'mqttv31', '3.1'],
      [4, 'mqttv311', '3.1.1'],
      [5, 'mqttv5', '5']
    ] as const) {
      const input = publish({ profile: profile({ protocolVersion }) })
      expect(command(publishCommand(input, 'mosquitto_pub', 'posix'))).toContain(`-V ${mosquitto}`)
      expect(command(publishCommand(input, 'mqttx', 'posix'))).toContain(`-V ${mqttx}`)
    }
  })
})

describe('subscribeCommand', () => {
  const sub = createSubscription({
    topic: 'sensors/+/temp',
    qos: 1,
    noLocal: true,
    retainAsPublished: true,
    retainHandling: 2,
    subscriptionIdentifier: 7
  })

  it('builds mosquitto_sub and MQTTX commands with the supported MQTT 5 options', () => {
    const input = { profile: profile(), subscription: sub }
    expect(command(subscribeCommand(input, 'mosquitto_sub', 'posix'))).toMatchInlineSnapshot(
      `"mosquitto_sub -h broker.example.com -p 1883 -V mqttv5 -t 'sensors/+/temp' -q 1 --retain-as-published --retain-handling never -v"`
    )
    expect(command(subscribeCommand(input, 'mqttx', 'powershell'))).toMatchInlineSnapshot(
      `"mqttx sub -h broker.example.com -p 1883 -V 5 -t 'sensors/+/temp' -q 1 -nl -rap -rh 2 -si 7"`
    )
  })

  it('omits the MQTT 5 options on MQTT 3.1.1 and quotes wildcards and shared filters', () => {
    const shared = createSubscription({ topic: '$share/g/#', retainAsPublished: true })
    const input = { profile: profile({ protocolVersion: 4 }), subscription: shared }
    expect(command(subscribeCommand(input, 'mosquitto_sub', 'posix'))).toMatchInlineSnapshot(
      `"mosquitto_sub -h broker.example.com -p 1883 -V mqttv311 -t '$share/g/#' -v"`
    )
    expect(command(subscribeCommand(input, 'mqttx', 'powershell'))).toMatchInlineSnapshot(
      `"mqttx sub -h broker.example.com -p 1883 -V 3.1.1 -t '$share/g/#'"`
    )
  })

  it('refuses mosquitto_sub over WebSockets', () => {
    const ws = profile({ protocol: 'ws', port: 8083 })
    expect(subscribeCommand({ profile: ws, subscription: sub }, 'mosquitto_sub', 'posix').ok).toBe(
      false
    )
    expect(subscribeCommand({ profile: ws, subscription: sub }, 'mqttx', 'posix').ok).toBe(true)
  })
})
