import { describe, expect, it } from 'vitest'
import { parseBrokerUrl } from '@/features/connections/utils/broker-url'

describe('parseBrokerUrl (paste a broker URL into the host field)', () => {
  it('splits mqtt and mqtts URLs, with the MQTT default ports', () => {
    expect(parseBrokerUrl('mqtt://broker.example.com')).toEqual({
      protocol: 'mqtt',
      host: 'broker.example.com',
      port: 1883
    })
    expect(parseBrokerUrl('mqtts://broker.example.com')).toMatchObject({
      protocol: 'mqtts',
      port: 8883
    })
    expect(parseBrokerUrl('mqtt://broker.example.com:1884')).toMatchObject({ port: 1884 })
  })

  it('takes the credentials out of the URL (decoded)', () => {
    expect(parseBrokerUrl('mqtts://alice:p%40ss%3Aword@broker.example.com:8883')).toEqual({
      protocol: 'mqtts',
      host: 'broker.example.com',
      port: 8883,
      username: 'alice',
      password: 'p@ss:word'
    })
    expect(parseBrokerUrl('mqtt://bob@10.0.0.2')).toEqual({
      protocol: 'mqtt',
      host: '10.0.0.2',
      port: 1883,
      username: 'bob'
    })
  })

  it('keeps the WebSocket path and the implied web ports', () => {
    expect(parseBrokerUrl('wss://broker.emqx.io:8084/mqtt')).toEqual({
      protocol: 'wss',
      host: 'broker.emqx.io',
      port: 8084,
      path: '/mqtt'
    })
    expect(parseBrokerUrl('ws://broker.local/mqtt')).toMatchObject({ port: 80, path: '/mqtt' })
    expect(parseBrokerUrl('wss://broker.local')).toEqual({
      protocol: 'wss',
      host: 'broker.local',
      port: 443
    })
    // A path is not part of an mqtt URL.
    expect(parseBrokerUrl('mqtt://broker.local:1883/ignored')).not.toHaveProperty('path')
  })

  it('reads http(s) URLs (Socket.IO servers) as ws(s), with the WebSocket query', () => {
    expect(parseBrokerUrl('https://api.example.com')).toEqual({
      protocol: 'wss',
      host: 'api.example.com',
      port: 443
    })
    expect(parseBrokerUrl('http://localhost:3000/socket.io/')).toEqual({
      protocol: 'ws',
      host: 'localhost',
      port: 3000,
      path: '/socket.io/'
    })
    expect(parseBrokerUrl('wss://feed.example.com/live?token=abc')?.path).toBe('/live?token=abc')
  })

  it('accepts the scheme aliases of other clients', () => {
    expect(parseBrokerUrl('tcp://broker.local:1883')?.protocol).toBe('mqtt')
    expect(parseBrokerUrl('ssl://broker.local:8883')?.protocol).toBe('mqtts')
    expect(parseBrokerUrl('tls://broker.local')?.protocol).toBe('mqtts')
    expect(parseBrokerUrl('MQTT+SSL://broker.local')?.protocol).toBe('mqtts')
  })

  it('handles IPv6 addresses, bracketed in URLs and host:port', () => {
    expect(parseBrokerUrl('mqtt://[::1]:1883')).toEqual({
      protocol: 'mqtt',
      host: '::1',
      port: 1883
    })
    expect(parseBrokerUrl('[2001:db8::1]:8883')).toEqual({ host: '2001:db8::1', port: 8883 })
  })

  it('splits a bare host:port', () => {
    expect(parseBrokerUrl('  broker.local:1883 ')).toEqual({ host: 'broker.local', port: 1883 })
    expect(parseBrokerUrl('192.168.1.5:1884')).toEqual({ host: '192.168.1.5', port: 1884 })
  })

  it.each([
    '',
    '   ',
    'broker.local', // a plain host is pasted as text
    'broker local:1883',
    'ftp://broker.local',
    'mqtt://',
    'mqtt://broker.local:0',
    'mqtt://broker.local:70000',
    'broker.local:99999',
    'user@broker.local:1883'
  ])('refuses %j', (text) => {
    expect(parseBrokerUrl(text)).toBeNull()
  })
})
