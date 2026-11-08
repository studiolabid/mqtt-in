import { describe, expect, it, vi, type Mock } from 'vitest'
import { isFocusLostTo, restoreFocus } from '@/features/shell/composables/usePaletteFocus'

function target(isConnected: boolean): {
  isConnected: boolean
  focus: Mock<(options?: FocusOptions) => void>
} {
  return { isConnected, focus: vi.fn<(options?: FocusOptions) => void>() }
}

describe('restoreFocus (A11Y-08)', () => {
  it('refocuses the captured element while it is in the document', () => {
    const el = target(true)
    expect(restoreFocus(el)).toBe(true)
    expect(el.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('leaves a removed element alone', () => {
    const el = target(false)
    expect(restoreFocus(el)).toBe(false)
    expect(el.focus).not.toHaveBeenCalled()
  })

  it('does nothing without a captured element', () => {
    expect(restoreFocus(null)).toBe(false)
    expect(restoreFocus(undefined)).toBe(false)
  })
})

describe('isFocusLostTo', () => {
  const doc: { body?: unknown } = {}
  const body = { ownerDocument: doc }
  doc.body = body
  const element = (inside: boolean): Element =>
    ({ ownerDocument: doc, inside }) as unknown as Element
  const container = {
    contains: (node: { inside?: boolean } | null) => node?.inside === true
  } as unknown as Node

  it('treats no element and <body> as lost focus', () => {
    expect(isFocusLostTo(null, container)).toBe(true)
    expect(isFocusLostTo(body as unknown as Element, container)).toBe(true)
  })

  it('treats focus left inside the closing palette as lost', () => {
    expect(isFocusLostTo(element(true), container)).toBe(true)
  })

  it('keeps focus an entry moved elsewhere (a dialog, a field)', () => {
    expect(isFocusLostTo(element(false), container)).toBe(false)
    expect(isFocusLostTo(element(false), null)).toBe(false)
  })
})
