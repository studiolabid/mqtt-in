import { acceptCompletion, autocompletion, type CompletionSource } from '@codemirror/autocomplete'
import { Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'

/**
 * Completion from `sources` (none: no completion at all). The list opens while typing and on
 * Ctrl+Space; Enter or Tab accepts. Without an open list Tab keeps moving focus out of the
 * editor (no Tab indentation, A11Y).
 */
export function completionExtension(sources: readonly CompletionSource[]): Extension {
  if (sources.length === 0) return []
  return [
    autocompletion({ override: [...sources], icons: false, activateOnTyping: true }),
    Prec.high(keymap.of([{ key: 'Tab', run: acceptCompletion }]))
  ]
}
