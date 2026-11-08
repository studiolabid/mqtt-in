import { describe, expect, it } from 'vitest'
import { describePacket } from '../../../src/main/services/mqtt/packet-log'

describe('describePacket', () => {
  it('skips PUBLISH and its acknowledgements', () => {
    expect(
      describePacket(
        { cmd: 'publish', topic: 't', payload: 'x', qos: 0, dup: false, retain: false },
        'out'
      )
    ).toBeNull()
    for (const cmd of ['puback', 'pubrec', 'pubrel', 'pubcomp'] as const) {
      expect(describePacket({ cmd, messageId: 1 }, 'in')).toBeNull()
    }
  })

  it('never logs the password and summarizes binary fields', () => {
    const line = describePacket(
      {
        cmd: 'connect',
        clientId: 'c1',
        protocolVersion: 5,
        clean: true,
        keepalive: 60,
        username: 'bob',
        password: Buffer.from('hunter2'),
        will: { topic: 'w', payload: Buffer.from('bye'), qos: 1, retain: false },
        properties: { authenticationData: Buffer.from([1, 2, 3]) }
      },
      'out'
    )
    expect(line?.message).toBe('→ CONNECT')
    expect(line?.detail).not.toContain('hunter2')
    expect(line?.detail).toContain('"password":"******"')
    expect(line?.detail).toContain('"payload":"<3 bytes>"')
    expect(line?.detail).toContain('"authenticationData":"<3 bytes>"')
    expect(line?.detail).toContain('"username":"bob"')
  })

  it('describes acknowledgements and pings', () => {
    expect(describePacket({ cmd: 'suback', messageId: 7, granted: [1, 128] }, 'in')).toEqual({
      message: '← SUBACK',
      detail: '{"messageId":7,"granted":[1,128]}'
    })
    expect(describePacket({ cmd: 'pingreq' }, 'out')).toEqual({ message: '→ PINGREQ' })
    expect(
      describePacket(
        { cmd: 'disconnect', reasonCode: 0x8e, properties: { reasonString: 'taken over' } },
        'in'
      )
    ).toEqual({
      message: '← DISCONNECT',
      detail: '{"reasonCode":142,"properties":{"reasonString":"taken over"}}'
    })
  })
})
