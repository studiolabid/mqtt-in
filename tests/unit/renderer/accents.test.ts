import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AccentColor } from '@shared/models'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import {
  ACCENT_TOKEN_PROPERTIES,
  ACCENTS,
  accentDefinition,
  accentTokens,
  DEFAULT_ACCENT,
  type AccentTokens
} from '@/lib/accents'

/** OKLCH (`oklch(L C H)`) → linear sRGB, clipped to the gamut. */
function linearRgb(color: string): [number, number, number] {
  const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(color)
  if (!match) throw new Error(`not an oklch() color: ${color}`)
  const [l, c, h] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clip = (v: number): number => Math.min(1, Math.max(0, v))
  return [
    clip(4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1),
    clip(-1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1),
    clip(-0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1)
  ]
}

function luminance(color: string): number {
  const [r, g, b] = linearRgb(color)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const BACKGROUND = { light: 'oklch(1 0 0)', dark: 'oklch(0.141 0.005 285.823)' } as const
const EVERY_ACCENT: Record<AccentColor, true> = {
  zinc: true,
  violet: true,
  blue: true,
  emerald: true,
  cyan: true,
  amber: true,
  orange: true,
  rose: true
}

const cases = ACCENTS.flatMap((accent) =>
  (['light', 'dark'] as const).map((theme) => ({
    name: `${accent.value} ${theme}`,
    theme,
    tokens: accent[theme]
  }))
)

describe('accent tokens (CT-18, A11Y-06)', () => {
  it.each(cases)('$name: button text on primary ≥ 4.5', ({ tokens }) => {
    expect(contrast(tokens.primaryForeground, tokens.primary)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tokens.sidebarPrimaryForeground, tokens.sidebarPrimary)).toBeGreaterThanOrEqual(
      4.5
    )
  })

  it.each(cases)('$name: primary text on the background ≥ 4.5', ({ tokens, theme }) => {
    expect(contrast(tokens.primaryText, BACKGROUND[theme])).toBeGreaterThanOrEqual(4.5)
  })

  it.each(cases)('$name: focus ring on the background ≥ 3', ({ tokens, theme }) => {
    expect(contrast(tokens.ring, BACKGROUND[theme])).toBeGreaterThanOrEqual(3)
  })

  it('reproduces the audit measurements (sanity check of the color math)', () => {
    // A11Y-06: Mono 16.97 / 13.96; the old light emerald-600 button 3.47.
    expect(contrast('oklch(0.985 0 0)', 'oklch(0.21 0.006 285.885)')).toBeCloseTo(16.97, 0)
    expect(contrast('oklch(0.979 0.021 166.113)', 'oklch(0.596 0.145 163.225)')).toBeCloseTo(
      3.47,
      1
    )
  })

  it('has exactly one entry per accent color, Mono (zinc) first and default', () => {
    const values = ACCENTS.map((accent) => accent.value)
    expect(new Set(values).size).toBe(values.length)
    expect([...values].sort()).toEqual(Object.keys(EVERY_ACCENT).sort())
    expect(ACCENTS[0]).toMatchObject({ value: 'zinc', label: 'Mono' })
    expect(DEFAULT_ACCENT).toBe('zinc')
    expect(DEFAULT_SETTINGS.accent).toBe('zinc')
    expect(accentDefinition('rose').label).toBe('Rose')
    expect(accentDefinition('nope' as AccentColor).value).toBe('zinc')
    expect(accentTokens('blue', true)).toBe(accentDefinition('blue').dark)
  })

  it('keeps main.css to the zinc base, equal to the zinc tokens (single source)', () => {
    const css = readFileSync(
      new URL('../../../src/renderer/src/assets/main.css', import.meta.url),
      'utf8'
    )
    expect(css).not.toMatch(/data-accent=/)
    const block = (selector: string): string => {
      const start = css.indexOf(`${selector} {`)
      expect(start, selector).toBeGreaterThanOrEqual(0)
      return css.slice(start, css.indexOf('}', start))
    }
    const zinc = accentDefinition('zinc')
    for (const [theme, selector] of [
      ['light', ':root'],
      ['dark', '.dark']
    ] as const) {
      const text = block(selector)
      for (const key of Object.keys(ACCENT_TOKEN_PROPERTIES) as Array<keyof AccentTokens>) {
        const property = ACCENT_TOKEN_PROPERTIES[key]
        expect(text, `${theme} ${property}`).toContain(`${property}: ${zinc[theme][key]};`)
      }
    }
    expect(css).toContain('--color-primary-text: var(--primary-text);')
  })
})
