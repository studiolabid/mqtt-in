import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  changedLines,
  changeFlashExtension,
  flashLines,
  MAX_FLASH_LINES
} from '@/components/common/lib/editor/change-flash'

const json = (value: object): string => JSON.stringify(value, null, 2)

describe('changedLines', () => {
  it('marks nothing for equal text or the first value', () => {
    expect(changedLines('a\nb', 'a\nb')).toEqual([])
    expect(changedLines('', 'a\nb')).toEqual([])
  })

  it('marks only the lines whose values changed in the same structure', () => {
    const before = json({ remaining: 3540, elapsed: 60, fmt: '59:00', host: 'x' })
    const after = json({ remaining: 3539, elapsed: 61, fmt: '59:00', host: 'x' })
    expect(changedLines(before, after)).toEqual([2, 3])
  })

  it('marks every line between the common prefix and suffix when lines were added', () => {
    expect(changedLines('a\nb\nz', 'a\nx\ny\nz')).toEqual([2, 3])
    expect(changedLines('a\nb\nc', 'a\nc')).toEqual([])
    expect(changedLines('a\nb', 'a\nb\nc')).toEqual([3])
  })

  it('gives up on a different document', () => {
    const lines = (prefix: string): string =>
      Array.from({ length: MAX_FLASH_LINES + 1 }, (_, i) => `${prefix}${i}`).join('\n')
    expect(changedLines(lines('a'), lines('b'))).toEqual([])
  })
})

describe('changeFlashExtension', () => {
  function markedLines(state: EditorState): number[] {
    const lines: number[] = []
    for (const source of state.facet(EditorView.decorations)) {
      const set = typeof source === 'function' ? null : source
      set?.between(0, state.doc.length, (from) => {
        lines.push(state.doc.lineAt(from).number)
      })
    }
    return lines
  }

  it('marks the lines of the new document and clears them on an empty list', () => {
    let state = EditorState.create({ doc: 'a\nb\nc', extensions: changeFlashExtension })
    state = state.update({
      changes: { from: 2, to: 3, insert: 'B' },
      effects: flashLines.of([2])
    }).state
    expect(markedLines(state)).toEqual([2])
    state = state.update({ effects: flashLines.of([]) }).state
    expect(markedLines(state)).toEqual([])
  })

  it('ignores line numbers outside the document', () => {
    let state = EditorState.create({ doc: 'a', extensions: changeFlashExtension })
    state = state.update({ effects: flashLines.of([0, 1, 5]) }).state
    expect(markedLines(state)).toEqual([1])
  })
})
