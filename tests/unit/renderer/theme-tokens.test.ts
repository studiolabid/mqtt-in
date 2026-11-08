/**
 * Contrast of the theme tokens (A11Y-01, A11Y-03, A11Y-04, A11Y-05): parses assets/main.css and
 * common/syntax.css, converts OKLCH to sRGB and checks WCAG 2 ratios, with translucent colors
 * composited the way the browser paints them (in sRGB).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ACCENTS } from '@/lib/accents'

type Rgb = readonly [number, number, number]
type Theme = 'light' | 'dark'

function read(path: string): string {
  return readFileSync(new URL(`../../../src/renderer/src/${path}`, import.meta.url), 'utf8')
}

/** `--name: value;` declarations of the first `selector {` block. */
function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`)
  if (start < 0) throw new Error(`no ${selector} block`)
  const body = css.slice(start, css.indexOf('}', start))
  const tokens: Record<string, string> = {}
  for (const match of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens[match[1]] = match[2].trim()
  return tokens
}

const main = read('assets/main.css')
const syntax = read('components/common/syntax.css')
const TOKENS: Record<Theme, Record<string, string>> = {
  light: { ...block(main, ':root'), ...block(syntax, ':root') },
  dark: { ...block(main, ':root'), ...block(main, '.dark'), ...block(syntax, '.dark') }
}

/** sRGB (0..1) and alpha of an `oklch(L C H)` / `oklch(L C H / A%)` color. */
function parse(color: string): { rgb: Rgb; alpha: number } {
  const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+)%)?\)$/.exec(color)
  if (!match) throw new Error(`not an oklch() color: ${color}`)
  const [l, c, h] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const encode = (v: number): number => {
    const x = Math.min(1, Math.max(0, v))
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
  }
  const rgb: Rgb = [
    encode(4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1),
    encode(-1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1),
    encode(-0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1)
  ]
  return { rgb, alpha: match[4] === undefined ? 1 : Number(match[4]) / 100 }
}

/** `color` at `opacity` (times its own alpha) painted over the opaque `base`. */
function over(color: string, base: Rgb, opacity = 1): Rgb {
  const { rgb, alpha } = parse(color)
  const a = alpha * opacity
  return [0, 1, 2].map((i) => rgb[i] * a + base[i] * (1 - a)) as unknown as Rgb
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** An opaque token as sRGB (translucent tokens are composited over the theme background). */
function token(theme: Theme, name: string): Rgb {
  const value = TOKENS[theme][name]
  if (!value) throw new Error(`--${name} is not defined (${theme})`)
  const background = parse(TOKENS[theme].background).rgb
  return over(value, background)
}

const THEMES: readonly Theme[] = ['light', 'dark']
/** Surfaces the app paints text and controls on. */
const SURFACES = ['background', 'panel', 'card', 'popover', 'sidebar'] as const

describe('focus rings (A11Y-01)', () => {
  it.each(THEMES)('%s: the ring and the sidebar ring are ≥ 3:1 on every surface', (theme) => {
    for (const surface of [...SURFACES, 'sidebar-accent', 'muted']) {
      expect(contrast(token(theme, 'ring'), token(theme, surface)), surface).toBeGreaterThanOrEqual(
        3
      )
      expect(
        contrast(token(theme, 'sidebar-ring'), token(theme, surface)),
        `sidebar ${surface}`
      ).toBeGreaterThanOrEqual(3)
    }
  })

  const accentRings = ACCENTS.flatMap((accent) =>
    THEMES.map((theme) => ({ name: `${accent.value} ${theme}`, theme, ring: accent[theme].ring }))
  )
  it.each(accentRings)(
    '$name: the accent ring is ≥ 3:1 on the background, sidebar and popover',
    ({ theme, ring }) => {
      const color = parse(ring).rgb
      for (const surface of ['background', 'sidebar', 'popover']) {
        expect(contrast(color, token(theme, surface)), surface).toBeGreaterThanOrEqual(3)
      }
    }
  )
})

describe('readable states (A11Y-03, A11Y-04)', () => {
  it.each(THEMES)('%s: muted text is ≥ 4.5:1 on its surfaces', (theme) => {
    const text = token(theme, 'muted-foreground')
    for (const surface of [...SURFACES, 'muted', 'accent', 'sidebar-accent']) {
      expect(contrast(text, token(theme, surface)), surface).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(THEMES)('%s: input borders are ≥ 3:1 (panel borders stay subtle)', (theme) => {
    const border = token(theme, 'input-border')
    for (const surface of SURFACES) {
      expect(contrast(border, token(theme, surface)), surface).toBeGreaterThanOrEqual(3)
    }
    // The dark inputs are filled with input/30.
    const fill = over(TOKENS[theme].input, token(theme, 'background'), 0.3)
    expect(contrast(border, fill)).toBeGreaterThanOrEqual(3)
    expect(contrast(token(theme, 'border'), token(theme, 'background'))).toBeLessThan(1.5)
  })

  it.each(THEMES)('%s: a toggle that is on is ≥ 3:1 against its surface', (theme) => {
    // ui/toggle: data-[state=on]:bg-foreground/10 + inset-ring-1 inset-ring-foreground/50.
    for (const surface of ['background', 'popover', 'sidebar', 'panel']) {
      const base = token(theme, surface)
      const fill = over(TOKENS[theme].foreground, base, 0.1)
      const ring = over(TOKENS[theme].foreground, fill, 0.5)
      expect(contrast(ring, base), surface).toBeGreaterThanOrEqual(3)
      expect(contrast(ring, fill), `${surface} fill`).toBeGreaterThanOrEqual(3)
      expect(contrast(token(theme, 'foreground'), fill), `${surface} text`).toBeGreaterThanOrEqual(
        4.5
      )
    }
  })

  it.each(THEMES)('%s: the menu highlight bar is ≥ 3:1 on the highlight', (theme) => {
    // Menus, palette, select: data-highlighted bg-accent + a 2 px foreground bar (main.css).
    const highlight = token(theme, 'accent')
    expect(contrast(token(theme, 'foreground'), highlight)).toBeGreaterThanOrEqual(3)
    expect(contrast(token(theme, 'destructive'), highlight)).toBeGreaterThanOrEqual(3)
  })
})

describe('status colors as text (A11Y-05)', () => {
  const STATUS = ['success', 'warning', 'info', 'incoming', 'outgoing', 'destructive'] as const

  it.each(STATUS)(
    'light %s: ≥ 4.5:1 on white, on its 10 / 15 % tint and on a selected row',
    (name) => {
      const color = TOKENS.light[name]
      const white = token('light', 'background')
      const text = parse(color).rgb
      expect(contrast(text, white)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(text, over(color, white, 0.1)), '/10').toBeGreaterThanOrEqual(4.5)
      expect(contrast(text, over(color, white, 0.15)), '/15').toBeGreaterThanOrEqual(4.5)
      expect(
        contrast(text, over(color, token('light', 'accent'), 0.1)),
        'row'
      ).toBeGreaterThanOrEqual(4.5)
      for (const surface of SURFACES) {
        expect(contrast(text, token('light', surface)), surface).toBeGreaterThanOrEqual(4.5)
      }
    }
  )

  it.each(STATUS)('dark %s: ≥ 4.5:1 on the dark surfaces and its 15 % tint', (name) => {
    const color = TOKENS.dark[name]
    const text = parse(color).rgb
    for (const surface of [...SURFACES, 'muted']) {
      expect(contrast(text, token('dark', surface)), surface).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(text, over(color, token('dark', 'background'), 0.15))).toBeGreaterThanOrEqual(
      4.5
    )
  })
})

describe('syntax colors (A11Y-04)', () => {
  const SYNTAX = ['key', 'string', 'number', 'bool', 'null', 'punct'] as const

  it.each(THEMES)(
    '%s: every syntax color is ≥ 4.5:1 on the editor surfaces and selected rows',
    (theme) => {
      for (const name of SYNTAX) {
        const color = token(theme, `syntax-${name}`)
        for (const surface of ['background', 'panel', 'card', 'accent']) {
          expect(
            contrast(color, token(theme, surface)),
            `${name} on ${surface}`
          ).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  )
})

describe('colour math', () => {
  it('reproduces the audit measurements', () => {
    // A11Y-04: the old light muted text on --muted 4.39. A11Y-01: the audited Mono ring
    // (zinc-400) at ring-ring/50 on white 1.55. A11Y-05: the old --warning on white 2.72.
    const white = parse('oklch(1 0 0)').rgb
    expect(
      contrast(parse('oklch(0.552 0.016 285.938)').rgb, parse('oklch(0.967 0.001 286.375)').rgb)
    ).toBeCloseTo(4.39, 1)
    expect(contrast(over('oklch(0.705 0.015 286.067)', white, 0.5), white)).toBeCloseTo(1.55, 1)
    expect(contrast(parse('oklch(0.705 0.17 62)').rgb, white)).toBeCloseTo(2.72, 1)
  })
})
