/**
 * Saved messages in the payload editor: type a saved name (`status`), or `/` for the whole
 * list, and Enter or Tab loads it. The list only opens while the payload holds nothing but that
 * word, so editing a real payload never pops it up; Ctrl+Space opens it anywhere. Accepting
 * replaces the whole payload and loads the rest of the saved message (topic, format, QoS)
 * through `pick`.
 */
import {
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource
} from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import type { SavedMessage } from '@/types'
import { previewText } from './payload-tools'

export interface SavedCompletionOptions {
  /** The saved messages, sorted as the list should show them. */
  items: () => readonly SavedMessage[]
  /** Loads the accepted message into the draft (the editor already holds its payload). */
  pick: (saved: SavedMessage) => void
}

/** The payload up to the cursor when it is one word, optionally after `/`. */
const LONE_WORD = /^\s*(\/?)(\S*)$/

function matches(items: readonly SavedMessage[], word: string, slash: boolean): SavedMessage[] {
  const needle = word.toLowerCase()
  if (needle === '') return [...items]
  const prefix = items.filter((item) => item.name.toLowerCase().startsWith(needle))
  if (!slash) return prefix
  // After `/` the word may be anywhere in the name too (prefix matches first).
  const inside = items.filter(
    (item) => !prefix.includes(item) && item.name.toLowerCase().includes(needle)
  )
  return [...prefix, ...inside]
}

function option(saved: SavedMessage, pick: (saved: SavedMessage) => void): Completion {
  return {
    label: saved.name,
    detail: saved.topic,
    info: previewText(saved.payload, 240) || 'empty payload',
    type: 'text',
    apply: (view: EditorView, completion: Completion): void => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: saved.payload },
        selection: { anchor: saved.payload.length },
        annotations: pickedCompletion.of(completion),
        userEvent: 'input.complete',
        scrollIntoView: true
      })
      pick(saved)
    }
  }
}

export function savedCompletionSource(options: SavedCompletionOptions): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const items = options.items()
    if (items.length === 0) return null
    const { state, pos } = context
    const before = state.sliceDoc(0, pos)
    const after = state.sliceDoc(pos)
    const lone = after.trim() === '' ? LONE_WORD.exec(before) : null
    if (lone) {
      const slash = lone[1] === '/'
      const word = lone[2]
      if (!slash && word === '' && !context.explicit) return null
      const found = matches(items, word, slash)
      if (found.length === 0) return null
      return {
        from: pos - word.length - (slash ? 1 : 0),
        options: found.map((saved) => option(saved, options.pick)),
        filter: false
      }
    }
    if (!context.explicit) return null
    return { from: pos, options: items.map((saved) => option(saved, options.pick)), filter: false }
  }
}
