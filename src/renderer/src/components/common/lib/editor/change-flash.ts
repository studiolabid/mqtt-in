/**
 * Briefly marks the lines a live value update changed (e.g. a topic's last value), so a
 * refresh that only changes `"58:59"` into `"58:58"` is visible at a glance.
 *
 * `changedLines` is a cheap line comparison (common prefix / suffix, then line by line when
 * the middle kept its line count), which covers the usual case of the same JSON structure
 * with new values. The CodeMirror side is a field of line decorations that the editor sets
 * together with the text change and clears after `FLASH_MS`.
 */
import { StateEffect, StateField, type Extension, type Range, type Text } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

/** How long changed lines stay marked. */
export const FLASH_MS = 1500

/** Updates that change more lines than this are not marked (a different document). */
export const MAX_FLASH_LINES = 400

/**
 * 1-based line numbers of `after` that differ from `before`. Empty when nothing changed or
 * when more than `MAX_FLASH_LINES` lines changed.
 */
export function changedLines(before: string, after: string): number[] {
  if (before === after || before === '') return []
  const a = before.split('\n')
  const b = after.split('\n')
  const max = Math.min(a.length, b.length)
  let start = 0
  while (start < max && a[start] === b[start]) start++
  let end = 0
  while (end < max - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const fromB = start
  const toB = b.length - end
  if (toB - fromB > MAX_FLASH_LINES) return []
  const lines: number[] = []
  const sameShape = a.length - end - start === toB - fromB
  for (let i = fromB; i < toB; i++) {
    if (sameShape && a[i] === b[i]) continue
    lines.push(i + 1)
  }
  return lines
}

/** Marks these 1-based lines of the new document (an empty list clears the marks). */
export const flashLines = StateEffect.define<readonly number[]>()

const changedLine = Decoration.line({ class: 'cm-changedLine' })

function decorate(doc: Text, lines: readonly number[]): DecorationSet {
  const ranges: Range<Decoration>[] = []
  for (const number of lines) {
    if (number < 1 || number > doc.lines) continue
    ranges.push(changedLine.range(doc.line(number).from))
  }
  return Decoration.set(ranges, true)
}

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = tr.docChanged ? value.map(tr.changes) : value
    for (const effect of tr.effects) {
      if (effect.is(flashLines)) next = decorate(tr.state.doc, effect.value)
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field)
})

/** The field behind `flashLines` (add it to editors that can mark changes). */
export const changeFlashExtension: Extension = flashField
