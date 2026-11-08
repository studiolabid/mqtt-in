/**
 * PERF-05: a chart window says how much data it really covers when older messages were
 * dropped (by the buffer or the chart's point cap).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { effectScope, shallowRef, type EffectScope } from 'vue'
import type { MqttMessage } from '@shared/models'
import { useTopicChart, type TopicChart } from '@/features/topics/composables/useTopicChart'
import {
  chartCoverage,
  coverageNote,
  formatSpan,
  windowLabel
} from '@/features/topics/utils/coverage'
import { message, utf8 } from '../../renderer/helpers'

const MINUTE = 60_000

/** `count` numeric messages spread evenly over `spanMs`, ending now. */
function history(count: number, spanMs: number): MqttMessage[] {
  const end = Date.now()
  const step = count > 1 ? spanMs / (count - 1) : 0
  return Array.from({ length: count }, (_, i) =>
    message({
      topic: 't',
      payload: utf8(String(i)),
      timestamp: end - spanMs + Math.round(i * step)
    })
  )
}

describe('chartCoverage', () => {
  it('flags a 15 minute window over 40 s of data whose older part was dropped', () => {
    const coverage = chartCoverage({
      history: history(239, 40_000),
      received: 3_000,
      pointLimit: 2_000,
      windowMs: 15 * MINUTE
    })
    expect(coverage).toEqual({ coverageMs: 40_000, limit: 'buffer', partial: true })
  })

  it('names the point cap when the chart holds its maximum', () => {
    const coverage = chartCoverage({
      history: history(2_000, 40_000),
      received: 3_098,
      pointLimit: 2_000,
      windowMs: 15 * MINUTE
    })
    expect(coverage.limit).toBe('points')
    expect(coverage.partial).toBe(true)
  })

  it('does not flag a window the data covers', () => {
    const coverage = chartCoverage({
      history: history(600, 10 * MINUTE),
      received: 5_000,
      pointLimit: 2_000,
      windowMs: 5 * MINUTE
    })
    expect(coverage.partial).toBe(false)
    expect(coverage.coverageMs).toBe(10 * MINUTE)
  })

  it('does not flag a new topic: nothing was dropped', () => {
    const coverage = chartCoverage({
      history: history(30, 30_000),
      received: 30,
      pointLimit: 2_000,
      windowMs: 15 * MINUTE
    })
    expect(coverage).toEqual({ coverageMs: 30_000, limit: null, partial: false })
  })

  it('flags the whole-history window whenever data was dropped', () => {
    const coverage = chartCoverage({
      history: history(100, 5_000),
      received: 120,
      pointLimit: 2_000,
      windowMs: Number.POSITIVE_INFINITY
    })
    expect(coverage.partial).toBe(true)
  })
})

describe('coverage texts', () => {
  it('formats spans', () => {
    expect(formatSpan(4_800)).toBe('4.8 s')
    expect(formatSpan(40_000)).toBe('40 s')
    expect(formatSpan(150_000)).toBe('2.5 min')
    expect(formatSpan(12 * MINUTE)).toBe('12 min')
    expect(formatSpan(125 * MINUTE)).toBe('2 h 5 min')
    expect(formatSpan(120 * MINUTE)).toBe('2 h')
  })

  it('explains why the chart is short', () => {
    const limits = { buffer: 10_000, points: 2_000 }
    expect(coverageNote({ coverageMs: 4_800, limit: 'buffer', partial: true }, limits)).toBe(
      'Showing the last 4.8 s — older messages were dropped from the buffer (limit 10,000)'
    )
    expect(coverageNote({ coverageMs: 40_000, limit: 'points', partial: true }, limits)).toBe(
      'Showing the last 40 s — the chart keeps the last 2,000 points'
    )
    expect(coverageNote({ coverageMs: 40_000, limit: null, partial: false }, limits)).toBeNull()
  })

  it('marks the windows longer than the data', () => {
    const partial = { coverageMs: 4_800, limit: 'buffer' as const, partial: true }
    expect(windowLabel('15m', 15 * MINUTE, partial)).toBe('15m (4.8 s)')
    expect(windowLabel('All', Number.POSITIVE_INFINITY, partial)).toBe('All (4.8 s)')
    expect(
      windowLabel('1m', MINUTE, { coverageMs: 2 * MINUTE, limit: 'buffer', partial: false })
    ).toBe('1m')
    expect(
      windowLabel('15m', 15 * MINUTE, { coverageMs: 4_800, limit: null, partial: false })
    ).toBe('15m')
  })
})

describe('useTopicChart coverage', () => {
  let scope: EffectScope | undefined

  afterEach(() => {
    scope?.stop()
  })

  function chart(
    messages: MqttMessage[],
    window: '5m' | '15m',
    received: number
  ): TopicChart | undefined {
    scope = effectScope()
    return scope.run(() =>
      useTopicChart({
        connectionId: () => 'coverage',
        topic: () => 't',
        history: shallowRef(messages),
        window: () => window,
        dark: () => false,
        received: () => received,
        pointLimit: 2_000
      })
    )
  }

  it('sets the flag for 40 s of data in a 15 minute window', () => {
    const model = chart(history(2_000, 40_000), '15m', 3_098)
    expect(model?.coverage.value.coverageMs).toBe(40_000)
    expect(model?.coverage.value.partial).toBe(true)
  })

  it('does not set it for 10 minutes of data in a 5 minute window', () => {
    const model = chart(history(600, 10 * MINUTE), '5m', 3_000)
    expect(model?.coverage.value.partial).toBe(false)
  })
})
