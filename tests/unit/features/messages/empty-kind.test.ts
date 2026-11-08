/**
 * RC-01 consumer: the message panel never says "none of them match" while a re-filtering pass is
 * still running (rows fill newest first), and keeps its other empty states.
 */
import { describe, expect, it } from 'vitest'
import { messageEmptyKind, type EmptyKindInput } from '@/features/messages/utils/empty-kind'

const base: EmptyKindInput = {
  rows: 0,
  total: 100_000,
  status: 'connected',
  listening: true,
  filterActive: true,
  pending: false,
  paused: false
}

describe('messageEmptyKind', () => {
  it('waits for the end of a re-filtering pass before saying that nothing matches', () => {
    expect(messageEmptyKind({ ...base, pending: true })).toBeNull()
    expect(messageEmptyKind(base)).toBe('filtered')
    expect(messageEmptyKind({ ...base, rows: 3, pending: true })).toBeNull()
    expect(messageEmptyKind({ ...base, rows: 3 })).toBeNull()
  })

  it('keeps the other empty states', () => {
    const empty = { ...base, total: 0, filterActive: false }
    expect(messageEmptyKind({ ...empty, status: 'reconnecting' })).toBe('connecting')
    expect(messageEmptyKind({ ...empty, status: 'error' })).toBe('disconnected')
    expect(messageEmptyKind(empty)).toBe('waiting')
    expect(messageEmptyKind({ ...empty, listening: false })).toBe('no-subscriptions')
    expect(messageEmptyKind({ ...base, filterActive: false, paused: true })).toBe('paused')
    // Rows lag the buffer by one throttle interval: the (empty) list stays meanwhile.
    expect(messageEmptyKind({ ...base, filterActive: false })).toBeNull()
  })
})
