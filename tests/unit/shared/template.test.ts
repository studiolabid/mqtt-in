import { describe, expect, it } from 'vitest'
import {
  hasTemplate,
  renderTemplate,
  TEMPLATE_VARIABLES,
  type TemplateContext
} from '@shared/template'
import { sequence, UUID_V4 } from './helpers'

/** Built from local components so `date` / `time` assertions are time-zone independent. */
const NOW = new Date(2024, 0, 2, 3, 4, 5, 678).getTime()

function ctx(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return { counter: 7, now: NOW, random: () => 0.5, ...overrides }
}

function render(text: string, overrides: Partial<TemplateContext> = {}): string {
  return renderTemplate(text, ctx(overrides))
}

describe('renderTemplate', () => {
  it('returns text without tokens unchanged', () => {
    expect(render('')).toBe('')
    expect(render('plain {text} with { braces }')).toBe('plain {text} with { braces }')
  })

  describe('time variables', () => {
    it('renders timestamp, unix and iso from ctx.now', () => {
      expect(render('{{timestamp}}')).toBe(String(NOW))
      expect(render('{{unix}}')).toBe(String(Math.floor(NOW / 1000)))
      expect(render('{{iso}}')).toBe(new Date(NOW).toISOString())
    })

    it('renders local date and time with zero padding', () => {
      expect(render('{{date}} {{time}}')).toBe('2024-01-02 03:04:05')
      const evening = new Date(2025, 11, 31, 23, 59, 9).getTime()
      expect(render('{{date}}T{{time}}', { now: evening })).toBe('2025-12-31T23:59:09')
    })

    it('floors unix seconds', () => {
      expect(render('{{unix}}', { now: 1999 })).toBe('1')
    })

    it('honours now = 0 instead of reading the clock', () => {
      expect(render('{{timestamp}}/{{unix}}/{{iso}}', { now: 0 })).toBe(
        '0/0/1970-01-01T00:00:00.000Z'
      )
    })

    it('reads the clock when now is omitted', () => {
      const before = Date.now()
      const rendered = Number(renderTemplate('{{timestamp}}', { counter: 1 }))
      expect(rendered).toBeGreaterThanOrEqual(before)
      expect(rendered).toBeLessThanOrEqual(Date.now())
    })
  })

  it('renders a fresh v4 UUID for every uuid token', () => {
    const [a, b] = render('{{uuid}} {{uuid}}').split(' ')
    expect(a).toMatch(UUID_V4)
    expect(b).toMatch(UUID_V4)
    expect(a).not.toBe(b)
  })

  it('renders the counter', () => {
    expect(render('#{{counter}}', { counter: 1 })).toBe('#1')
    expect(render('{{counter}}-{{counter}}', { counter: 42 })).toBe('42-42')
  })

  describe('random', () => {
    it('without arguments: a float rounded to 4 decimals, trailing zeros dropped', () => {
      expect(render('{{random}}', { random: () => 0.123456 })).toBe('0.1235')
      expect(render('{{random}}', { random: () => 0.5 })).toBe('0.5')
      expect(render('{{random}}', { random: () => 0 })).toBe('0')
    })

    it('with a range: 2 decimals by default', () => {
      expect(render('{{random(20,30)}}')).toBe('25.00')
      expect(render('{{random(20,30)}}', { random: () => 0 })).toBe('20.00')
    })

    it('third argument sets the decimals, clamped to 0..10', () => {
      expect(render('{{random(0,1,0)}}', { random: () => 0.6 })).toBe('1')
      expect(render('{{random(0,1,4)}}', { random: () => 0.123456 })).toBe('0.1235')
      expect(render('{{random(0,1,99)}}', { random: () => 0.123456 })).toBe('0.1234560000')
      expect(render('{{random(0,1,-3)}}', { random: () => 0.123456 })).toBe('0')
    })

    it('accepts spaces, decimals and negative bounds', () => {
      expect(render('{{ random( -1.5 , 1.5 ) }}')).toBe('0.00')
      expect(render('{{random(0.5,1.5,1)}}', { random: () => 0.25 })).toBe('0.8')
    })

    it('reversed bounds still yield a value between them (debatable: not rejected)', () => {
      expect(render('{{random(30,20)}}', { random: () => 0.25 })).toBe('27.50')
    })

    it('a single argument falls back to the plain 0..1 form (debatable)', () => {
      expect(render('{{random(5)}}')).toBe('0.5')
    })

    it.each(['{{random(a,b)}}', '{{random(1,b)}}', '{{random(1,2,x)}}', '{{random(1,Infinity)}}'])(
      'leaves invalid arguments untouched: %s',
      (token) => {
        expect(render(token)).toBe(token)
      }
    )
  })

  describe('randomInt', () => {
    it('is inclusive of both bounds', () => {
      expect(render('{{randomInt(1,6)}}', { random: () => 0 })).toBe('1')
      expect(render('{{randomInt(1,6)}}', { random: () => 0.999999 })).toBe('6')
      expect(render('{{randomInt(-5,-1)}}', { random: () => 0 })).toBe('-5')
    })

    it('defaults to 0..100 and to an upper bound of 100', () => {
      expect(render('{{randomInt}}', { random: () => 0 })).toBe('0')
      expect(render('{{randomInt}}', { random: () => 0.999999 })).toBe('100')
      expect(render('{{randomInt(50)}}', { random: () => 0.999999 })).toBe('100')
    })

    it('rounds fractional bounds inwards', () => {
      expect(render('{{randomInt(1.2, 3.8)}}', { random: () => 0 })).toBe('2')
      expect(render('{{randomInt(1.2, 3.8)}}', { random: () => 0.999999 })).toBe('3')
    })

    it('supports min == max', () => {
      expect(render('{{randomInt(5,5)}}', { random: () => 0.999999 })).toBe('5')
    })

    it.each([
      '{{randomInt(10,1)}}',
      '{{randomInt(1.6,1.4)}}',
      '{{randomInt(a,5)}}',
      '{{randomInt(1,b)}}',
      '{{randomInt(500)}}'
    ])('leaves invalid ranges untouched: %s', (token) => {
      expect(render(token)).toBe(token)
    })
  })

  describe('pick', () => {
    it('picks an item with the random source', () => {
      expect(render('{{pick(on,off)}}', { random: () => 0 })).toBe('on')
      expect(render('{{pick(on,off)}}', { random: () => 0.99 })).toBe('off')
    })

    it('trims spaces and strips matching quotes', () => {
      expect(render('{{pick( "a b" , \'c\' )}}', { random: () => 0 })).toBe('a b')
      expect(render('{{pick( "a b" , \'c\' )}}', { random: () => 0.99 })).toBe('c')
      expect(render('{{pick("x\')}}')).toBe('"x\'')
    })

    it('ignores empty items', () => {
      expect(render('{{pick(a,,b,)}}', { random: () => 0.6 })).toBe('b')
    })

    it('cannot quote commas (debatable: items are split on every comma)', () => {
      expect(render('{{pick("a,b",c)}}', { random: () => 0 })).toBe('"a')
    })

    it.each(['{{pick()}}', '{{pick( , )}}', '{{pick}}'])(
      'without items stays untouched: %s',
      (t) => {
        expect(render(t)).toBe(t)
      }
    )
  })

  it('renders bool from the random source', () => {
    expect(render('{{bool}}', { random: () => 0.49 })).toBe('true')
    expect(render('{{bool}}', { random: () => 0.5 })).toBe('false')
  })

  it('renders every token of a document independently', () => {
    const text = '{"t": {{random(20,30)}}, "n": {{counter}}, "on": {{bool}}, "s": "{{pick(a,b)}}"}'
    expect(render(text, { random: sequence(0.5, 0.9, 0.1) })).toBe(
      '{"t": 25.00, "n": 7, "on": false, "s": "a"}'
    )
  })

  it('leaves unknown tokens and malformed braces untouched', () => {
    const text = '{{unknown}} {{ Uuid }} {{random(1,2} {uuid} {{}} {{1}} {{ }} {{random_int}}'
    expect(render(text)).toBe(text)
  })

  it('is case-sensitive', () => {
    expect(render('{{COUNTER}} {{Counter}}')).toBe('{{COUNTER}} {{Counter}}')
  })

  it('tolerates whitespace inside tokens', () => {
    expect(render('{{ counter }}|{{  randomInt ( 1 , 1 )  }}')).toBe('7|1')
  })

  it('handles tokens glued to JSON braces', () => {
    expect(render('{{{counter}}}')).toBe('{7}')
    expect(render('{"a":{{counter}}}')).toBe('{"a":7}')
  })

  it('ignores arguments of tokens that take none', () => {
    expect(render('{{counter(5)}}|{{bool(1)}}', { random: () => 0 })).toBe('7|true')
  })

  it('renders every documented variable', () => {
    for (const variable of TEMPLATE_VARIABLES) {
      expect(variable.description.length).toBeGreaterThan(0)
      expect(render(variable.token)).not.toBe(variable.token)
    }
  })
})

describe('hasTemplate', () => {
  it.each([
    '{{uuid}}',
    'x {{ counter }} y',
    '{{random(1,2)}}',
    '{{pick(a,b)}}',
    '{{nope}} {{bool}}'
  ])('detects a known token in %j', (text) => {
    expect(hasTemplate(text)).toBe(true)
  })

  it.each(['', 'plain', '{{unknown}}', '{{ uuid', '{uuid}', '{{UUID}}', '{{}}'])(
    'ignores %j',
    (text) => {
      expect(hasTemplate(text)).toBe(false)
    }
  )

  it('recognises every documented variable', () => {
    for (const variable of TEMPLATE_VARIABLES) expect(hasTemplate(variable.token)).toBe(true)
  })

  it.each<[string, string]>([
    ['an unclosed token followed by 200,000 spaces', '{{a' + ' '.repeat(200_000)],
    ['50,000 unclosed argument lists', '{{a('.repeat(50_000)],
    ['an unclosed argument list followed by 200,000 characters', '{{a(' + 'x'.repeat(200_000)],
    ['an unclosed name of 200,000 letters', '{{' + 'a'.repeat(200_000)]
  ])('scans %s in linear time', (_label, text) => {
    const started = performance.now()
    expect(hasTemplate(text)).toBe(false)
    expect(renderTemplate(text, { counter: 1 })).toBe(text)
    expect(performance.now() - started).toBeLessThan(50)
  })

  it('finds tokens after pathological text and glued to argument lists', () => {
    expect(hasTemplate(`${'{{a('.repeat(1000)}{{uuid}}`)).toBe(true)
    expect(renderTemplate('{{pick({"a":1},{"b":2})}}', { counter: 1, random: () => 0 })).toBe(
      '{"a":1}'
    )
    // Arguments stop at the next `{{`: a token inside an argument list is rendered on its own.
    expect(renderTemplate('{{pick({{counter}})}}', { counter: 7 })).toBe('{{pick(7)}}')
  })

  it('is stable across repeated calls (no shared regex state)', () => {
    const text = 'a {{uuid}} b'
    expect([hasTemplate(text), hasTemplate(text), hasTemplate(text)]).toEqual([true, true, true])
    expect(render('{{counter}}')).toBe('7')
    expect(hasTemplate(text)).toBe(true)
  })
})
