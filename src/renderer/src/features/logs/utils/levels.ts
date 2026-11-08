/**
 * Visual tone of each log level (token classes only).
 */
import type { LogLevel } from '@shared/models'

export interface LevelTone {
  /** Small status dot (filter toggles). */
  dot: string
  /** Level badge in a row. */
  badge: string
  /** Row tint, if any. */
  row: string
}

export const LEVEL_TONES: Readonly<Record<LogLevel, LevelTone>> = {
  debug: {
    dot: 'bg-muted-foreground/70',
    badge: 'bg-muted text-muted-foreground',
    row: ''
  },
  info: {
    dot: 'bg-info',
    badge: 'bg-info/10 text-info',
    row: ''
  },
  warn: {
    dot: 'bg-warning',
    badge: 'bg-warning/15 text-warning',
    row: 'bg-warning/[0.045]'
  },
  error: {
    dot: 'bg-destructive',
    badge: 'bg-destructive/10 text-destructive',
    row: 'bg-destructive/[0.05]'
  }
}
