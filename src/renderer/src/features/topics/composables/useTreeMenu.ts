/**
 * The topic tree's context menu target (one `ContextMenu` serves every row).
 *
 * - A right-click on a row targets that row (and selects it); on empty space the tree-wide
 *   menu opens (target `null`).
 * - Shift+F10 / the Menu key fire `contextmenu` at the focused tree itself (A11Y-14): the
 *   selected row is scrolled into view and gets the menu, opened at the row.
 * - The target carries what the retained actions need: whether the topic has a payload and how
 *   many known-retained topics its subtree holds (read once, when the menu opens).
 */
import { nextTick, ref, type Ref } from 'vue'
import { useMessagesStore } from '@/stores/messages'
import type { TopicRow } from '@/utils/topic-tree'
import type { TreeMenuTarget } from '../utils/tree-views'

export interface TreeMenuOptions {
  connectionId: () => string
  scroller: Readonly<Ref<HTMLElement | null>>
  rows: () => readonly TopicRow[]
  selected: () => string | null
  selectedIndex: () => number
  select(topic: string): void
  /** Scrolls the row at `index` into view unless it is fully visible. */
  ensureVisible(index: number): void
}

export interface TreeMenu {
  target: Ref<TreeMenuTarget | null>
  /** The tree's `@contextmenu.capture` handler. */
  onContextMenu(event: MouseEvent): void
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

export function useTreeMenu(options: TreeMenuOptions): TreeMenu {
  const messages = useMessagesStore()
  const target = ref<TreeMenuTarget | null>(null)

  function rowElement(topic: string): HTMLElement | undefined {
    const rendered = options.scroller.value?.querySelectorAll<HTMLElement>('[data-topic]') ?? []
    for (const element of rendered) if (element.dataset.topic === topic) return element
    return undefined
  }

  /** Re-dispatches the menu event at the selected row (after scrolling it into view). */
  async function openAtSelected(): Promise<void> {
    const topic = options.selected()
    const index = options.selectedIndex()
    if (topic === null || index < 0) return
    options.ensureVisible(index)
    await nextTick()
    await nextFrame()
    const element = rowElement(topic)
    if (!element) return
    const box = element.getBoundingClientRect()
    element.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: box.left + Math.min(48, box.width / 3),
        clientY: box.bottom
      })
    )
  }

  function onContextMenu(event: MouseEvent): void {
    const element = event.target instanceof Element ? event.target.closest('[data-topic]') : null
    const topic = element instanceof HTMLElement ? element.dataset.topic : undefined
    // The keyboard targets the focused tree itself; a mouse right-click has button 2.
    const keyboard = event.target === options.scroller.value && event.button !== 2
    if (topic === undefined && keyboard && options.selectedIndex() >= 0) {
      event.preventDefault() // this event opens nothing; the re-dispatched one opens the menu
      void openAtSelected()
      return
    }
    const row = topic === undefined ? undefined : options.rows().find((r) => r.node.topic === topic)
    if (!row) {
      target.value = null
      return
    }
    const { node } = row
    target.value = {
      topic: node.topic,
      hasChildren: row.hasChildren,
      expanded: row.expanded,
      retained: node.retained,
      hasPayload: (node.lastMessage?.payload.length ?? 0) > 0,
      retainedBelow: row.hasChildren
        ? messages.retainedBelow(options.connectionId(), node.topic).length
        : 0
    }
    if (node.topic !== options.selected()) options.select(node.topic)
  }

  return { target, onContextMenu }
}
