/**
 * A11Y-07: the publisher's narrow header folds properties, history and repeat into a "More"
 * menu. Opening them from there anchors the popovers to the More button; when they close and
 * focus fell back to the page, it continues on the More button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import {
  useFoldedControls,
  type FoldedControls
} from '@/features/publish/composables/useFoldedControls'

/** A stand-in for a DOM element: shown or hidden, focusable. */
class FakeElement {
  focused = false
  constructor(readonly shown: boolean) {}
  getClientRects(): { length: number } {
    return { length: this.shown ? 1 : 0 }
  }
  checkVisibility(): boolean {
    return this.shown
  }
  closest(): null {
    return null
  }
  focus(): void {
    this.focused = true
    fakeDocument.activeElement = this
  }
}

const fakeDocument: { body: FakeElement; activeElement: FakeElement | null } = {
  body: new FakeElement(true),
  activeElement: null
}

/** A panel whose "More" button is shown (narrow) or hidden (wide). */
function panelWith(more: FakeElement): HTMLElement {
  const panel = {
    querySelector: (selector: string) => (selector.includes('publish-more') ? more : null),
    querySelectorAll: (selector: string) => (selector.includes('publish-more') ? [more] : [])
  }
  return panel as unknown as HTMLElement
}

let scope: EffectScope

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('HTMLElement', FakeElement)
  vi.stubGlobal('document', fakeDocument)
  fakeDocument.activeElement = fakeDocument.body
  scope = effectScope()
})

afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function setup(more: FakeElement): { folded: FoldedControls; openRepeat: () => void } {
  const openRepeat = vi.fn()
  const panel = ref<HTMLElement | null>(panelWith(more))
  const folded = scope.run(() => useFoldedControls(panel, openRepeat))
  if (!folded) throw new Error('effect scope is not active')
  return { folded, openRepeat }
}

describe('useFoldedControls', () => {
  it('runs the menu actions: properties and history popovers, the repeat dialog', () => {
    const { folded, openRepeat } = setup(new FakeElement(true))
    folded.open('properties')
    expect(folded.propertiesOpen.value).toBe(true)
    folded.open('history')
    expect(folded.historyOpen.value).toBe(true)
    folded.open('repeat')
    expect(openRepeat).toHaveBeenCalledOnce()
  })

  it('anchors a popover to the More button only while that button is shown', () => {
    const shown = new FakeElement(true)
    const narrow = setup(shown)
    narrow.folded.open('history')
    expect(narrow.folded.anchor.value).toBe(shown)

    const wide = setup(new FakeElement(false))
    wide.folded.historyOpen.value = true // opened from its own trigger
    expect(wide.folded.anchor.value).toBeNull()
  })

  it('returns a lost focus to the More button when a folded popover closes', async () => {
    const more = new FakeElement(true)
    const { folded } = setup(more)
    folded.open('properties')
    folded.propertiesOpen.value = false
    await nextTick()
    await nextTick()
    expect(more.focused).toBe(true)
  })

  it('leaves the focus alone when it went somewhere visible', async () => {
    const more = new FakeElement(true)
    const { folded } = setup(more)
    const editor = new FakeElement(true)
    folded.open('history')
    editor.focus() // e.g. an entry loaded into the editor
    folded.historyOpen.value = false
    await vi.advanceTimersByTimeAsync(400)
    expect(more.focused).toBe(false)
    expect(fakeDocument.activeElement).toBe(editor)
  })
})
