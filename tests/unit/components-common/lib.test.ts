import { describe, expect, it } from 'vitest'
import { isJsonLike, tokenizeJsonInline } from '@/components/common/lib/json-tokens'
import { segmentTopic } from '@/components/common/lib/topic-segments'
import { initials } from '@/components/common/lib/initials'
import { formatShortcut, formatShortcutKey, isMacPlatform } from '@/components/common/lib/shortcut'
import { colorName, normalizeHex, sameColor } from '@/components/common/lib/color'
import { downsample, sparklineGeometry } from '@/components/common/lib/sparkline'
import { qosLevel, toQos } from '@/components/common/lib/qos'
import {
  connectionStatusLabel,
  isTransitionalStatus,
  statusGlyph,
  statusTone
} from '@/components/common/lib/status'
import type { ConnectionStatus } from '@shared/models'

describe('json-tokens', () => {
  it('detects JSON-like text', () => {
    expect(isJsonLike('  {"a":1}')).toBe(true)
    expect(isJsonLike('[1,2]')).toBe(true)
    expect(isJsonLike('hello')).toBe(false)
    expect(isJsonLike('')).toBe(false)
  })

  it('classifies keys, strings, numbers, booleans, null and punctuation', () => {
    const tokens = tokenizeJsonInline('{"t": 21.5, "ok": true, "x": null, "s": "a\\"b", "n": -1e3}')
    const kinds = tokens.map((t) => `${t.kind}:${t.text}`)
    expect(kinds).toContain('key:"t"')
    expect(kinds).toContain('number:21.5')
    expect(kinds).toContain('bool:true')
    expect(kinds).toContain('null:null')
    expect(kinds).toContain('string:"a\\"b"')
    expect(kinds).toContain('number:-1e3')
    expect(tokens.map((t) => t.text).join('')).toBe(
      '{"t": 21.5, "ok": true, "x": null, "s": "a\\"b", "n": -1e3}'
    )
  })

  it('tolerates truncated previews and keeps every character', () => {
    const text = '{"msg": "this is cut…'
    const tokens = tokenizeJsonInline(text)
    expect(tokens.map((t) => t.text).join('')).toBe(text)
    expect(tokens[tokens.length - 1]).toEqual({ kind: 'string', text: '"this is cut…' })
  })

  it('does not treat identifiers starting with keywords as keywords', () => {
    const tokens = tokenizeJsonInline('[trueish, nullable]')
    expect(tokens.some((t) => t.kind === 'bool' || t.kind === 'null')).toBe(false)
  })

  it('only tokenizes the first max characters', () => {
    const long = `[${'1,'.repeat(400)}1]`
    const tokens = tokenizeJsonInline(long, 300)
    expect(tokens.map((t) => t.text).join('')).toBe(long)
    expect(tokens[tokens.length - 1].kind).toBe('plain')
    expect(tokens[tokens.length - 1].text.length).toBe(long.length - 300)
  })
})

describe('topic-segments', () => {
  const render = (topic: string, highlight = ''): string =>
    segmentTopic(topic, highlight)
      .map((p) => (p.highlighted ? `[${p.text}]` : p.kind === 'text' ? p.text : `<${p.text}>`))
      .join('')

  it('splits separators and whole-level wildcards', () => {
    expect(render('a/+/b/#')).toBe('a</><+></>b</><#>')
    expect(render('a+b/c#')).toBe('a+b</>c#')
    expect(render('/lead//double/')).toBe('</>lead</></>double</>')
  })

  it('highlights case-insensitively, across levels, all occurrences', () => {
    expect(render('Sensors/Temp/sensor', 'sensor')).toBe('[Sensor]s</>Temp</>[sensor]')
    expect(render('a/b/c', 'a/b')).toBe('[a][/][b]</>c')
    expect(render('aaaa', 'aa')).toBe('[aa][aa]')
  })

  it('ignores blank highlights and keeps the topic intact', () => {
    const topic = '$SYS/broker/uptime'
    expect(segmentTopic(topic, '   ').every((p) => !p.highlighted)).toBe(true)
    expect(
      segmentTopic(topic, 'BROKER')
        .map((p) => p.text)
        .join('')
    ).toBe(topic)
  })
})

describe('initials', () => {
  it('uses the first letters of the first two words', () => {
    expect(initials('Home Assistant')).toBe('HA')
    expect(initials('test.mosquitto.org')).toBe('TM')
    expect(initials('  broker 2 ')).toBe('B2')
  })

  it('falls back to the first two characters', () => {
    expect(initials('localhost')).toBe('LO')
    expect(initials('x')).toBe('X')
    expect(initials('🚀🛰️')).toBe('🚀🛰️')
    expect(initials('   ')).toBe('?')
  })
})

describe('shortcut', () => {
  it('maps keys per platform', () => {
    expect(formatShortcut(['Mod', 'Shift', 'k'], 'darwin')).toBe('⌘⇧K')
    expect(formatShortcut(['Mod', 'Shift', 'k'], 'win32')).toBe('Ctrl+Shift+K')
    expect(formatShortcutKey('Enter', true)).toBe('↵')
    expect(formatShortcutKey('Backspace', false)).toBe('Backspace')
    expect(formatShortcutKey('Escape', true)).toBe('Esc')
    expect(formatShortcutKey('F5', false)).toBe('F5')
    expect(isMacPlatform('MacIntel')).toBe(true)
    expect(isMacPlatform('linux')).toBe(false)
  })
})

describe('color', () => {
  it('normalizes hex colors', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex('8b5cf6')).toBe('#8b5cf6')
    expect(normalizeHex(' #22C55E ')).toBe('#22c55e')
    expect(normalizeHex('#12345')).toBeNull()
    expect(normalizeHex('red')).toBeNull()
    expect(sameColor('#8B5CF6', '8b5cf6')).toBe(true)
    expect(colorName('#8B5CF6')).toBe('Violet')
    expect(colorName('#71717A')).toBe('Gray')
    expect(colorName('#123456')).toBe('#123456')
  })
})

describe('sparkline', () => {
  it('handles empty, single and constant data', () => {
    expect(sparklineGeometry([], 64, 20).last).toBeNull()
    expect(sparklineGeometry([NaN, Infinity], 64, 20).line).toBe('')
    const single = sparklineGeometry([5], 64, 20)
    expect(single.line).toBe('M2 10 L62 10')
    const flat = sparklineGeometry([3, 3, 3], 64, 20)
    expect(flat.line).toBe('M2 10 L32 10 L62 10')
  })

  it('maps min to the bottom and max to the top', () => {
    const g = sparklineGeometry([0, 10], 64, 20, 2)
    expect(g.line).toBe('M2 18 L62 2')
    expect(g.area).toBe('M2 18 L62 2 L62 20 L2 20 Z')
    expect(g.last).toEqual({ x: 62, y: 2 })
  })

  it('downsamples to a min/max envelope in order', () => {
    const values = Array.from({ length: 1000 }, (_, i) => Math.sin(i / 10))
    const reduced = downsample(values, 64)
    expect(reduced.length).toBeLessThanOrEqual(128)
    expect(Math.max(...reduced)).toBeCloseTo(Math.max(...values), 5)
    expect(Math.min(...reduced)).toBeCloseTo(Math.min(...values), 5)
  })
})

describe('qos & status', () => {
  it('narrows and describes QoS levels', () => {
    expect(toQos('2')).toBe(2)
    expect(toQos(0)).toBe(0)
    expect(toQos('3')).toBeNull()
    expect(toQos(null)).toBeNull()
    expect(qosLevel(1).label).toBe('At least once')
  })

  it('maps statuses to tones and labels', () => {
    expect(statusTone('connected')).toBe('success')
    expect(statusTone('reconnecting')).toBe('warning')
    expect(isTransitionalStatus('disconnecting')).toBe(true)
    expect(isTransitionalStatus('error')).toBe(false)
    expect(connectionStatusLabel('error')).toBe('Error')
  })

  it('gives every status a glyph shape, so the state reads without color (A11Y-18)', () => {
    const glyphs: Record<ConnectionStatus, string> = {
      connected: statusGlyph('connected'),
      disconnected: statusGlyph('disconnected'),
      connecting: statusGlyph('connecting'),
      reconnecting: statusGlyph('reconnecting'),
      disconnecting: statusGlyph('disconnecting'),
      error: statusGlyph('error')
    }
    expect(glyphs).toEqual({
      connected: 'filled',
      disconnected: 'ring',
      connecting: 'pulse',
      reconnecting: 'pulse',
      disconnecting: 'pulse',
      error: 'alert'
    })
    // Connected, disconnected, changing and failed all differ in shape.
    const shapes = ['connected', 'disconnected', 'connecting', 'error'] as const
    expect(new Set(shapes.map(statusGlyph)).size).toBe(shapes.length)
    // Every transitional status pulses.
    for (const status of Object.keys(glyphs) as ConnectionStatus[]) {
      expect(statusGlyph(status) === 'pulse').toBe(isTransitionalStatus(status))
    }
    expect(statusGlyph('unknown' as ConnectionStatus)).toBe('ring')
  })
})
