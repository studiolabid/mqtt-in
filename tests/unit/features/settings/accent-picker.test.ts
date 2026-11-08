import { describe, expect, it } from 'vitest'
import { ACCENTS } from '@/lib/accents'
import { ACCENT_OPTIONS, accentSwatchStyle, isAccentColor } from '@/features/settings/utils/options'

describe('accent picker options (KNOWN-ACCENT)', () => {
  it('come from the single accent table, Mono first', () => {
    expect(ACCENT_OPTIONS).toBe(ACCENTS)
    expect(ACCENT_OPTIONS).toHaveLength(8)
    expect(ACCENT_OPTIONS[0]).toMatchObject({ value: 'zinc', label: 'Mono' })
  })

  it('paint each swatch with the tokens the theme applies', () => {
    for (const accent of ACCENT_OPTIONS) {
      expect(accentSwatchStyle(accent, false)).toEqual({
        '--swatch': accent.light.primary,
        '--swatch-foreground': accent.light.primaryForeground
      })
      expect(accentSwatchStyle(accent, true)).toEqual({
        '--swatch': accent.dark.primary,
        '--swatch-foreground': accent.dark.primaryForeground
      })
    }
  })

  it('accepts only known accents', () => {
    expect(isAccentColor('zinc')).toBe(true)
    expect(isAccentColor('rose')).toBe(true)
    expect(isAccentColor('purple')).toBe(false)
    expect(isAccentColor(undefined)).toBe(false)
  })
})
