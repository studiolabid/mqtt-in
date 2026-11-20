import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { toggleJsonComment } from '@/components/common/lib/editor/json-comments'

/** Runs Ctrl+/ on `doc` with the selection `[anchor, head]` (offsets) and returns the text. */
function toggle(doc: string, anchor: number, head = anchor): string {
  let state = EditorState.create({ doc, selection: EditorSelection.single(anchor, head) })
  const handled = toggleJsonComment({
    state,
    dispatch: (tr: Transaction) => {
      state = tr.state
    }
  })
  expect(handled).toBe(true)
  return state.doc.toString()
}

const DOC = '{\n  "id": 4,\n  "min": 5\n}'

describe('toggleJsonComment (Ctrl+/)', () => {
  it('comments the cursor line at its indentation', () => {
    expect(toggle(DOC, DOC.indexOf('"min"'))).toBe('{\n  "id": 4,\n  // "min": 5\n}')
  })

  it('uncomments // and # lines', () => {
    const slashes = '{\n  // "min": 5\n}'
    expect(toggle(slashes, slashes.indexOf('min'))).toBe('{\n  "min": 5\n}')
    const hash = '{\n  # "min": 5\n}'
    expect(toggle(hash, hash.indexOf('min'))).toBe('{\n  "min": 5\n}')
    expect(toggle('#{"a":1}', 0)).toBe('{"a":1}')
  })

  it('comments a selection at the common indentation', () => {
    const from = DOC.indexOf('"id"')
    const to = DOC.indexOf('5')
    expect(toggle(DOC, from, to)).toBe('{\n  // "id": 4,\n  // "min": 5\n}')
  })

  it('uncomments a selection mixing // and #', () => {
    const doc = '{\n  // "id": 4,\n  # "min": 5\n}'
    expect(toggle(doc, doc.indexOf('//'), doc.indexOf('5'))).toBe('{\n  "id": 4,\n  "min": 5\n}')
  })

  it('comments the whole selection when only part of it is commented', () => {
    const doc = '// a\nb'
    expect(toggle(doc, 0, doc.length)).toBe('// // a\n// b')
  })

  it('leaves out a line the selection only touches at its start', () => {
    const doc = 'a\nb'
    expect(toggle(doc, 0, 2)).toBe('// a\nb')
  })
})
