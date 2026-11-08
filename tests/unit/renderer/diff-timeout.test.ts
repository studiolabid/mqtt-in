import { describe, expect, it, vi } from 'vitest'

// Simulates jsdiff giving up (timeout reached) to test the fallback deterministically.
vi.mock('diff', () => ({ diffLines: vi.fn(() => undefined) }))

describe('lineDiff fallback', () => {
  it('reports everything removed then everything added when the diff times out', async () => {
    const { lineDiff } = await import('@/utils/diff')
    const { diffLines } = await import('diff')
    expect(lineDiff('a\nb', 'c', { timeoutMs: 5 })).toEqual([
      { kind: 'removed', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'c' }
    ])
    expect(diffLines).toHaveBeenCalledWith('a\nb', 'c', expect.objectContaining({ timeout: 5 }))
  })
})
