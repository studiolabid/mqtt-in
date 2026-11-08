import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatClock,
  formatCompact,
  formatDate,
  formatDuration,
  formatNumber,
  formatRate,
  formatRelative,
  formatTimestamp,
  modKey
} from '@/utils/format'

// Local time on purpose: the formatters display local time.
const TS = new Date(2026, 0, 2, 3, 4, 5, 6).getTime()
const numberFormat = new Intl.NumberFormat()
const compactFormat = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1
})

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [150 * 1024, '150 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
    [3 * 1024 ** 3, '3.0 GB']
  ])('%d → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })

  it('treats negative and non-finite input as 0', () => {
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B')
  })

  it('caps the unit at TB', () => {
    expect(formatBytes(1024 ** 5)).toBe('1024 TB')
  })
})

describe('formatNumber / formatCompact', () => {
  it('formats with the current locale', () => {
    expect(formatNumber(1234567)).toBe(numberFormat.format(1234567))
  })

  it('uses compact notation from 10 000 on', () => {
    expect(formatCompact(9999)).toBe(numberFormat.format(9999))
    expect(formatCompact(12_345)).toBe(compactFormat.format(12_345))
    expect(formatCompact(3_400_000)).toBe(compactFormat.format(3_400_000))
  })
})

describe('formatRate', () => {
  it('shows one decimal below 10/s and integers above', () => {
    expect(formatRate(0)).toBe('0/s')
    expect(formatRate(-3)).toBe('0/s')
    expect(formatRate(2.54)).toBe('2.5/s')
    expect(formatRate(340.4)).toBe('340/s')
    expect(formatRate(12_345)).toBe(`${compactFormat.format(12_345)}/s`)
  })
})

describe('clock, date and timestamps', () => {
  it('formats the local time with optional milliseconds', () => {
    expect(formatClock(TS)).toBe('03:04:05.006')
    expect(formatClock(TS, false)).toBe('03:04:05')
  })

  it('formats the local date', () => {
    expect(formatDate(TS)).toBe('2026-01-02')
  })

  it('formats timestamps according to the setting', () => {
    expect(formatTimestamp(TS, 'time', true)).toBe('03:04:05.006')
    expect(formatTimestamp(TS, 'datetime', false)).toBe('2026-01-02 03:04:05')
    expect(formatTimestamp(Date.now() - 2_000, 'relative', true)).toBe('just now')
  })
})

describe('formatRelative', () => {
  const now = TS + 40 * 86_400_000

  it.each([
    [now - 1_000, 'just now'],
    [now + 5_000, 'just now'],
    [now - 12_000, '12s ago'],
    [now - 5 * 60_000, '5m ago'],
    [now - 3 * 3_600_000, '3h ago'],
    [now - 2 * 86_400_000, '2d ago'],
    [now - 30 * 86_400_000, '30d ago']
  ])('%d → %s', (ts, expected) => {
    expect(formatRelative(ts, now)).toBe(expected)
  })

  it('shows the date beyond 30 days', () => {
    expect(formatRelative(TS, now)).toBe('2026-01-02')
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [42_000, '0:42'],
    [723_000, '12:03'],
    [3_723_000, '1:02:03'],
    [-5_000, '0:00'],
    [59_999, '0:59']
  ])('%d ms → %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })
})

describe('modKey', () => {
  it('is ⌘ on macOS and Ctrl elsewhere', () => {
    expect(modKey('darwin')).toBe('⌘')
    expect(modKey('win32')).toBe('Ctrl')
    expect(modKey('linux')).toBe('Ctrl')
  })
})
