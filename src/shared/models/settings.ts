/**
 * Application settings (persisted in `settings.json`).
 */
import type { ViewFormat } from './message'

export type ThemeMode = 'system' | 'light' | 'dark'

export type AccentColor =
  'zinc' | 'violet' | 'blue' | 'emerald' | 'cyan' | 'amber' | 'orange' | 'rose'

export type TimestampFormat = 'time' | 'datetime' | 'relative'

export interface AppSettings {
  theme: ThemeMode
  accent: AccentColor
  /** Ring-buffer size per connection (oldest messages are dropped). */
  maxMessagesPerConnection: number
  defaultViewFormat: ViewFormat
  timestampFormat: TimestampFormat
  showMilliseconds: boolean
  autoScroll: boolean
  wordWrap: boolean
  confirmBeforeDelete: boolean
}
