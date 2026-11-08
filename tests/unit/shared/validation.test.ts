import { isIP } from 'node:net'
import { describe, expect, it } from 'vitest'
import { isIpv6Literal, validateBrokerHost } from '@shared/validation'

const HOST_ONLY = 'Enter only the host name (no mqtt://, path, port or credentials)'

describe('validateBrokerHost', () => {
  it.each([
    'broker.local',
    '10.0.0.1',
    '::1',
    'localhost',
    'broker.emqx.io',
    'my_broker',
    'bücher.example',
    '2001:db8::8a2e:370:7334',
    '::ffff:192.0.2.1',
    'FE80::1',
    'broker.local.'
  ])('accepts %j', (host) => {
    expect(validateBrokerHost(host)).toBeNull()
  })

  it.each([
    ['mqtt://h', HOST_ONLY],
    ['u:p@h', HOST_ONLY],
    ['h/x', HOST_ONLY],
    ['h x', 'Host must not contain spaces or control characters'],
    ['h:1883', HOST_ONLY],
    ['', 'Host is required']
  ])('refuses %j: %s', (host, message) => {
    expect(validateBrokerHost(host)).toBe(message)
  })

  it.each([
    'wss://broker.local:8084/mqtt',
    'user@broker.local',
    'broker.local?x=1',
    'broker.local#frag',
    'broker\\share',
    'a%20b',
    '[::1]:1883',
    'fe80::1%eth0',
    '1::2::3',
    '12345::1'
  ])('refuses the URL part in %j', (host) => {
    expect(validateBrokerHost(host)).toBe(HOST_ONLY)
  })

  it('ignores surrounding whitespace but refuses blanks and control characters inside', () => {
    expect(validateBrokerHost('  broker.local\t')).toBeNull()
    expect(validateBrokerHost('   ')).toBe('Host is required')
    for (const host of ['a\tb', 'a\u0000b', 'a\u007fb', 'a b', 'a b']) {
      expect(validateBrokerHost(host)).toBe('Host must not contain spaces or control characters')
    }
  })

  it('asks for IPv6 addresses without brackets', () => {
    expect(validateBrokerHost('[::1]')).toBe('Enter the IPv6 address without brackets')
    expect(validateBrokerHost('[2001:db8::1]')).toBe('Enter the IPv6 address without brackets')
  })

  it('refuses dotted numbers that are no IPv4 address', () => {
    expect(validateBrokerHost('256.1.1.1')).toBe('Enter a valid IPv4 address')
    expect(validateBrokerHost('010.0.0.1')).toBe('Enter a valid IPv4 address')
    expect(validateBrokerHost('255.255.255.255')).toBeNull()
  })

  it('limits host names to 253 characters (a final dot aside)', () => {
    const name = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`
    expect(name).toHaveLength(253)
    expect(validateBrokerHost(name)).toBeNull()
    expect(validateBrokerHost(`${name}.`)).toBeNull()
    expect(validateBrokerHost(`${name}e`)).toBe('Host is too long (max 253 characters)')
  })
})

describe('isIpv6Literal', () => {
  it('agrees with node:net isIP for addresses without a zone id', () => {
    const inputs = [
      '::1',
      '::',
      '1::',
      '1:2:3:4:5:6:7:8',
      '1:2:3:4:5:6:7:8:9',
      '1:2:3:4:5:6:7::',
      '::1:2:3:4:5:6:7',
      '1::2::3',
      '::ffff:192.0.2.1',
      '::FFFF:1.2.3.4',
      '1:2:3:4:5:6:1.2.3.4',
      '1:2:3:4:5:6:7:1.2.3.4',
      '::ffff:256.1.1.1',
      ':1',
      '1:',
      ':::',
      '12345::1',
      'g::1',
      '10.0.0.1',
      'localhost',
      'a:1883',
      '[::1]'
    ]
    for (const input of inputs) expect(isIpv6Literal(input), input).toBe(isIP(input) === 6)
  })

  it('refuses zone ids (mqtt.js cannot parse them in a broker URL)', () => {
    expect(isIP('fe80::1%eth0')).toBe(6)
    expect(isIpv6Literal('fe80::1%eth0')).toBe(false)
  })
})
