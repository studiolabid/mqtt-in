import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MqttMessage } from '@shared/models'
import { MessageBatcher } from '../../../src/main/services/mqtt/message-batcher'

function message(id: number): MqttMessage {
  return {
    id,
    connectionId: 'c1',
    direction: 'in',
    topic: 't',
    payload: new Uint8Array([id]),
    qos: 0,
    retain: false,
    dup: false,
    timestamp: id
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('MessageBatcher', () => {
  it('flushes every 50 ms', () => {
    const sink = vi.fn()
    const batcher = new MessageBatcher(sink)
    batcher.push(message(1))
    batcher.push(message(2))
    vi.advanceTimersByTime(49)
    expect(sink).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(sink).toHaveBeenCalledOnce()
    expect(sink.mock.calls[0][0].map((m: MqttMessage) => m.id)).toEqual([1, 2])
    vi.advanceTimersByTime(500)
    expect(sink).toHaveBeenCalledOnce()
  })

  it('flushes immediately at 500 messages', () => {
    const sink = vi.fn()
    const batcher = new MessageBatcher(sink)
    for (let i = 1; i <= 501; i++) batcher.push(message(i))
    expect(sink).toHaveBeenCalledOnce()
    expect(sink.mock.calls[0][0]).toHaveLength(500)
    expect(batcher.pending).toBe(1)
    vi.advanceTimersByTime(50)
    expect(sink).toHaveBeenCalledTimes(2)
    expect(sink.mock.calls[1][0].map((m: MqttMessage) => m.id)).toEqual([501])
  })

  it('honours custom options', () => {
    const sink = vi.fn()
    const batcher = new MessageBatcher(sink, { intervalMs: 10, maxBatch: 2 })
    batcher.push(message(1))
    vi.advanceTimersByTime(10)
    expect(sink).toHaveBeenCalledTimes(1)
    batcher.push(message(2))
    batcher.push(message(3))
    expect(sink).toHaveBeenCalledTimes(2)
  })

  it('flush() sends now and is a no-op when empty', () => {
    const sink = vi.fn()
    const batcher = new MessageBatcher(sink)
    batcher.flush()
    expect(sink).not.toHaveBeenCalled()
    batcher.push(message(1))
    batcher.flush()
    expect(sink).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(100)
    expect(sink).toHaveBeenCalledOnce()
  })

  it('dispose() flushes pending messages and ignores later ones', () => {
    const sink = vi.fn()
    const batcher = new MessageBatcher(sink)
    batcher.push(message(1))
    batcher.dispose()
    expect(sink).toHaveBeenCalledOnce()
    batcher.push(message(2))
    vi.advanceTimersByTime(100)
    expect(sink).toHaveBeenCalledOnce()
  })

  it('survives a throwing sink', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const batcher = new MessageBatcher(() => {
      throw new Error('window gone')
    })
    batcher.push(message(1))
    expect(() => vi.advanceTimersByTime(50)).not.toThrow()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
