/**
 * Accent colors: the single source of the accent theme tokens (CT-18) and of the accent picker.
 *
 * `useThemeSync` applies the active accent's tokens as CSS custom properties on `<html>`
 * (and keeps `data-accent`, which charts observe). `assets/main.css` only defines the zinc base
 * (identical to the `zinc` entry here), which applies before the settings are loaded.
 *
 * Mono (`zinc`, black and white) is the default; the colored accents are opt-in. Every value
 * passes WCAG AA (checked by tests/unit/renderer/accents.test.ts):
 * - `primaryForeground` on `primary` ≥ 4.5 (button text),
 * - `primaryText` on the theme background ≥ 4.5 (text in the accent color: `text-primary-text`),
 * - `ring` on the theme background, sidebar and popover ≥ 3 (focus rings; also checked by
 *   tests/unit/renderer/theme-tokens.test.ts).
 * Shades are Tailwind's; where the 500/600 shade fails, the 700/800 shade is used (light) or
 * the 400 shade for text on the dark background.
 */
import type { AccentColor } from '@shared/models'

export interface AccentTokens {
  /** `--primary`: primary buttons, selection, active states. */
  primary: string
  /** `--primary-foreground`: text and icons on `primary`. */
  primaryForeground: string
  /** `--ring`: focus rings. */
  ring: string
  /** `--sidebar-primary`. */
  sidebarPrimary: string
  /** `--sidebar-primary-foreground`. */
  sidebarPrimaryForeground: string
  /** `--primary-text`: the accent as a text color on the background (`text-primary-text`). */
  primaryText: string
}

export interface AccentDefinition {
  value: AccentColor
  label: string
  light: AccentTokens
  dark: AccentTokens
}

/** CSS custom property of each token. */
export const ACCENT_TOKEN_PROPERTIES: Readonly<Record<keyof AccentTokens, string>> = {
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  ring: '--ring',
  sidebarPrimary: '--sidebar-primary',
  sidebarPrimaryForeground: '--sidebar-primary-foreground',
  primaryText: '--primary-text'
}

function tokens(primary: string, foreground: string, ring: string, text = primary): AccentTokens {
  return {
    primary,
    primaryForeground: foreground,
    ring,
    sidebarPrimary: primary,
    sidebarPrimaryForeground: foreground,
    primaryText: text
  }
}

const ZINC_900 = 'oklch(0.21 0.006 285.885)'
const ZINC_200 = 'oklch(0.92 0.004 286.32)'
/** Mono focus rings: >= 4.6:1 on every light surface, >= 4.5:1 on every dark one (A11Y-01). */
const RING_LIGHT = 'oklch(0.55 0.015 286)'
const RING_DARK = 'oklch(0.65 0.016 286)'
const NEAR_WHITE = 'oklch(0.985 0 0)'

/** Every accent, zinc ('Mono', the default) first. */
export const ACCENTS: readonly AccentDefinition[] = [
  {
    value: 'zinc',
    label: 'Mono',
    light: tokens(ZINC_900, NEAR_WHITE, RING_LIGHT),
    dark: tokens(ZINC_200, ZINC_900, RING_DARK)
  },
  {
    value: 'violet',
    label: 'Violet',
    // violet-600; dark: the same 600 (500 fails with the light foreground), text violet-400.
    light: tokens(
      'oklch(0.541 0.281 293.009)',
      'oklch(0.969 0.016 293.756)',
      'oklch(0.606 0.25 292.717)'
    ),
    dark: tokens(
      'oklch(0.541 0.281 293.009)',
      'oklch(0.969 0.016 293.756)',
      'oklch(0.606 0.25 292.717)',
      'oklch(0.702 0.183 293.541)'
    )
  },
  {
    value: 'blue',
    label: 'Blue',
    // blue-600, text blue-700 (600 is too light on the tinted badges); dark: text blue-400.
    light: tokens(
      'oklch(0.546 0.245 262.881)',
      'oklch(0.97 0.014 254.604)',
      'oklch(0.623 0.214 259.815)',
      'oklch(0.488 0.243 264.376)'
    ),
    dark: tokens(
      'oklch(0.546 0.245 262.881)',
      'oklch(0.97 0.014 254.604)',
      'oklch(0.623 0.214 259.815)',
      'oklch(0.707 0.165 254.624)'
    )
  },
  {
    value: 'emerald',
    label: 'Emerald',
    // emerald-700 (600 fails with the light foreground), text emerald-800; dark: emerald-500.
    light: tokens(
      'oklch(0.508 0.118 165.612)',
      'oklch(0.979 0.021 166.113)',
      'oklch(0.596 0.145 163.225)',
      'oklch(0.432 0.095 166.913)'
    ),
    dark: tokens(
      'oklch(0.696 0.17 162.48)',
      'oklch(0.262 0.051 172.552)',
      'oklch(0.596 0.145 163.225)'
    )
  },
  {
    value: 'cyan',
    label: 'Cyan',
    // cyan-700, text cyan-800; dark: cyan-500 with a dark foreground.
    light: tokens(
      'oklch(0.52 0.105 223.128)',
      'oklch(0.984 0.019 200.873)',
      'oklch(0.609 0.126 221.723)',
      'oklch(0.45 0.085 224.283)'
    ),
    dark: tokens(
      'oklch(0.715 0.143 215.221)',
      'oklch(0.302 0.056 229.695)',
      'oklch(0.609 0.126 221.723)'
    )
  },
  {
    value: 'amber',
    label: 'Amber',
    // amber-500 with a dark foreground; as text (light) amber-800.
    light: tokens(
      'oklch(0.769 0.188 70.08)',
      'oklch(0.279 0.077 45.635)',
      'oklch(0.666 0.179 58.318)',
      'oklch(0.473 0.137 46.201)'
    ),
    dark: tokens(
      'oklch(0.769 0.188 70.08)',
      'oklch(0.279 0.077 45.635)',
      'oklch(0.666 0.179 58.318)'
    )
  },
  {
    value: 'orange',
    label: 'Orange',
    // orange-700 (600 fails), text orange-800; dark: the same 700, text orange-400.
    light: tokens(
      'oklch(0.553 0.195 38.402)',
      'oklch(0.98 0.016 73.684)',
      'oklch(0.646 0.222 41.116)',
      'oklch(0.47 0.157 37.304)'
    ),
    dark: tokens(
      'oklch(0.553 0.195 38.402)',
      'oklch(0.98 0.016 73.684)',
      'oklch(0.646 0.222 41.116)',
      'oklch(0.75 0.183 55.934)'
    )
  },
  {
    value: 'rose',
    label: 'Rose',
    // rose-700 (600 fails with the light foreground); dark: the same 700, text rose-400.
    light: tokens(
      'oklch(0.514 0.222 16.935)',
      'oklch(0.969 0.015 12.422)',
      'oklch(0.586 0.253 17.585)'
    ),
    dark: tokens(
      'oklch(0.514 0.222 16.935)',
      'oklch(0.969 0.015 12.422)',
      'oklch(0.586 0.253 17.585)',
      'oklch(0.712 0.194 13.428)'
    )
  }
]

/** The default accent: Mono (black and white). */
export const DEFAULT_ACCENT: AccentColor = 'zinc'

/** The definition of an accent (Mono for an unknown value from old settings). */
export function accentDefinition(value: AccentColor): AccentDefinition {
  return ACCENTS.find((accent) => accent.value === value) ?? ACCENTS[0]
}

/** The tokens of an accent in a theme. */
export function accentTokens(value: AccentColor, dark: boolean): AccentTokens {
  const accent = accentDefinition(value)
  return dark ? accent.dark : accent.light
}
