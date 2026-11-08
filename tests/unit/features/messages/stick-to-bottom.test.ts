/**
 * PERF-04: following a live list must not force layouts. A scroller whose layout reads are
 * counted stands in for the DOM (each read would force a synchronous layout in Chromium).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { effectScope, nextTick, shallowRef, type EffectScope, type ShallowRef } from 'vue'
import type { MqttMessage } from '@shared/models'
import {
  createStickToBottom,
  type ScrollerElement,
  type StickToBottom,
  type StickToBottomHandlers
} from '@/features/messages/composables/useStickToBottom'
import { messages } from '../../renderer/helpers'

const ROW = 52
const VIEWPORT = 520

interface FakeScroller {
  el: ScrollerElement
  reads: { scrollTop: number; scrollHeight: number; clientHeight: number }
  writes: number[]
  total(): number
  reset(): void
  scrollTo(value: number): void
}

/** A scroller of `rows() × ROW` px content that counts every layout read. */
function fakeScroller(rows: () => number): FakeScroller {
  const reads = { scrollTop: 0, scrollHeight: 0, clientHeight: 0 }
  const writes: number[] = []
  let top = 0
  const max = (): number => Math.max(0, rows() * ROW - VIEWPORT)
  const el: ScrollerElement = {
    get scrollTop() {
      reads.scrollTop++
      return top
    },
    set scrollTop(value: number) {
      writes.push(value)
      top = Math.min(Math.max(0, value), max())
    },
    get scrollHeight() {
      reads.scrollHeight++
      return Math.max(rows() * ROW, VIEWPORT)
    },
    get clientHeight() {
      reads.clientHeight++
      return VIEWPORT
    }
  }
  return {
    el,
    reads,
    writes,
    /** Total layout reads since the last reset. */
    total: () => reads.scrollTop + reads.scrollHeight + reads.clientHeight,
    reset() {
      reads.scrollTop = 0
      reads.scrollHeight = 0
      reads.clientHeight = 0
    },
    /** The user scrolled (no write through the logic). */
    scrollTo(value: number) {
      top = Math.min(Math.max(0, value), max())
    }
  }
}

let scope: EffectScope | undefined

afterEach(() => {
  scope?.stop()
  scope = undefined
})

interface Setup {
  rows: ShallowRef<readonly MqttMessage[]>
  box: FakeScroller
  frames: Array<() => void>
  runFrames(): void
  stick: StickToBottom & { handlers: StickToBottomHandlers }
}

function setup(count: number, follow = true): Setup {
  const rows = shallowRef<readonly MqttMessage[]>(messages(count))
  const box = fakeScroller(() => rows.value.length)
  const frames: Array<() => void> = []
  scope = effectScope()
  const stick = scope.run(() =>
    createStickToBottom({
      scroller: shallowRef(box.el),
      rows,
      rowHeight: ROW,
      follow,
      frame: (callback) => frames.push(callback)
    })
  )
  if (!stick) throw new Error('no scope')
  const runFrames = (): void => {
    while (frames.length > 0) frames.shift()?.()
  }
  stick.handlers.onMounted()
  runFrames()
  return { rows, box, frames, runFrames, stick }
}

describe('useStickToBottom (following a live list)', () => {
  it('jumps to new rows without reading the layout', async () => {
    const { rows, box, stick } = setup(30)
    box.reset()
    rows.value = [...rows.value, ...messages(5)]
    await nextTick()
    expect(box.reads.scrollHeight).toBe(0)
    expect(box.total()).toBe(0)
    expect(box.writes.at(-1)).toBe(35 * ROW)
    expect(stick.atBottom.value).toBe(true)
    expect(stick.tail.value).toBe(true)
    expect(stick.viewportHeight.value).toBe(VIEWPORT)
  })

  it('does not measure the scroll event its own jump causes', async () => {
    const { rows, box, frames, runFrames, stick } = setup(30)
    rows.value = [...rows.value, ...messages(5)]
    await nextTick()
    box.reset()
    // The browser reports the programmatic scroll: nothing is read, now or in the next frame.
    stick.handlers.onScroll()
    const queued = frames.length
    runFrames()
    expect(queued).toBe(1) // only the frame that ends the "programmatic" window
    expect(box.total()).toBe(0)
  })

  it('measures a user scroll in the next animation frame, not in the event', () => {
    const { box, frames, runFrames, stick } = setup(40)
    box.scrollTo(5 * ROW)
    box.reset()
    stick.handlers.onScroll()
    expect(box.total()).toBe(0)
    expect(frames).toHaveLength(1)
    stick.handlers.onScroll() // coalesced into the same frame
    expect(frames).toHaveLength(1)
    runFrames()
    expect(box.total()).toBeGreaterThan(0)
    expect(stick.atBottom.value).toBe(false)
    expect(stick.tail.value).toBe(false)
  })

  it('stops following on a wheel up at once, and keeps the reader in place', async () => {
    const { rows, box, stick } = setup(40)
    stick.handlers.onWheel({ deltaY: -40 })
    expect(stick.atBottom.value).toBe(false)
    expect(stick.tail.value).toBe(false)
    box.scrollTo(10 * ROW)
    const before = box.writes.length
    rows.value = [...rows.value.slice(3), ...messages(3)] // eviction at the head
    await nextTick()
    // The anchor row moved up by 3 rows: the viewport follows it.
    expect(box.writes.slice(before)).toEqual([7 * ROW])
    expect(stick.unseen.value).toBe(3)
  })

  it('does not follow when auto-scroll is off', async () => {
    const { rows, box, stick } = setup(30, false)
    expect(stick.tail.value).toBe(false)
    const before = box.writes.length
    rows.value = [...rows.value, ...messages(5)]
    await nextTick()
    expect(box.writes.length).toBe(before)
  })

  it('suspends following while the scrollbar is held', async () => {
    const { rows, box, stick } = setup(30)
    stick.handlers.onPointerDown(true)
    expect(stick.tail.value).toBe(false)
    const before = box.writes.length
    rows.value = [...rows.value, ...messages(2)]
    await nextTick()
    expect(box.writes.length).toBe(before)
    stick.handlers.endDrag()
    expect(stick.tail.value).toBe(false) // not at the bottom any more (2 rows below)
  })
})
