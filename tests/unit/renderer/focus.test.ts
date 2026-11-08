import { describe, expect, it, vi, type Mock } from 'vitest'
import { focusFirst, isFocusable, type FocusCandidate } from '@/utils/focus'

interface FakeElement extends FocusCandidate {
  name: string
  focus: Mock<(options?: FocusOptions) => void>
}

function element(
  name: string,
  options: Omit<Partial<FocusCandidate>, 'focus'> & { visible?: boolean } = {}
): FakeElement {
  const { visible = true, ...rest } = options
  return {
    name,
    focus: vi.fn<(options?: FocusOptions) => void>(),
    getClientRects: () => ({ length: visible ? 1 : 0 }),
    ...rest
  }
}

function root(map: Record<string, unknown[]>): { querySelectorAll(selector: string): unknown[] } {
  return {
    querySelectorAll(selector: string): unknown[] {
      if (selector === 'bad[') throw new Error('invalid selector')
      return map[selector] ?? []
    }
  }
}

describe('focusFirst (A11Y-11)', () => {
  it('focuses the first visible match, trying the selectors in order', async () => {
    const hidden = element('hidden list', { visible: false })
    const list = element('list')
    const tab = element('tab')
    const scope = root({ '[data-list]': [hidden, list], '[data-tab]': [tab] })
    await expect(focusFirst(['[data-list]', '[data-tab]'], scope)).resolves.toBe(true)
    expect(hidden.focus).not.toHaveBeenCalled()
    expect(list.focus).toHaveBeenCalledTimes(1)
    expect(tab.focus).not.toHaveBeenCalled()
  })

  it('falls back to later selectors and skips disabled or inert elements', async () => {
    const disabled = element('disabled', { disabled: true })
    const inert = element('inert', {
      closest: (selector) => (selector.includes('inert') ? {} : null)
    })
    const fallback = element('fallback')
    const scope = root({ '.a': [disabled, inert, 'not an element'], '.b': [fallback] })
    await expect(focusFirst(['bad[', '.a', '.b'], scope)).resolves.toBe(true)
    expect(disabled.focus).not.toHaveBeenCalled()
    expect(inert.focus).not.toHaveBeenCalled()
    expect(fallback.focus).toHaveBeenCalled()
  })

  it('returns false (and focuses nothing) when nothing matches', async () => {
    const hidden = element('hidden', { visible: false })
    await expect(focusFirst(['.x', '.y'], root({ '.x': [hidden] }))).resolves.toBe(false)
    expect(hidden.focus).not.toHaveBeenCalled()
    // Without a document (node) and without a root there is nothing to look in.
    await expect(focusFirst(['.x'])).resolves.toBe(false)
  })

  it('waits a tick before looking (the DOM updates after a state change)', async () => {
    const late = element('late')
    const map: Record<string, unknown[]> = {}
    const pending = focusFirst(['.late'], root(map))
    map['.late'] = [late] // rendered by the same tick's flush
    await expect(pending).resolves.toBe(true)
    expect(late.focus).toHaveBeenCalled()
  })

  it('prefers checkVisibility when the element has it', () => {
    const invisible = element('v', { checkVisibility: () => false })
    expect(isFocusable(invisible)).toBe(false)
    expect(isFocusable(element('w', { checkVisibility: () => true, visible: false }))).toBe(true)
  })
})
