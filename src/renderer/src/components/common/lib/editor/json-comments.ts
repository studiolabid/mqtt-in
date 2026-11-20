/**
 * Line comments in the JSON editor (JSONC, like Sublime Text): `//` or `#` disables a line, it is
 * greyed out and never sent. Ctrl+/ (⌘/) toggles them: lines that are all commented (either
 * marker) are uncommented, otherwise `// ` is added at the lines' common indentation.
 * The JSON grammar has no comments, so the marks come from a per-line scan of the visible lines
 * (`jsonLineCommentStart`), not from the syntax tree.
 */
import { jsonLanguage } from '@codemirror/lang-json'
import {
  Prec,
  RangeSetBuilder,
  type ChangeSpec,
  type Extension,
  type Line,
  type StateCommand
} from '@codemirror/state'
import {
  Decoration,
  keymap,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate
} from '@codemirror/view'
import { jsonLineCommentStart } from '@shared/payload'

/** Indentation, then the comment marker and one optional space. */
const COMMENTED = /^([ \t]*)(?:\/\/|#) ?/

/** The lines touched by the selection (a range ending at a line start leaves that line out). */
function selectedLines(state: Parameters<StateCommand>[0]['state']): Line[] {
  const lines = new Map<number, Line>()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from)
    let last = state.doc.lineAt(range.to)
    if (!range.empty && range.to === last.from && last.number > first.number) {
      last = state.doc.line(last.number - 1)
    }
    for (let n = first.number; n <= last.number; n++) lines.set(n, state.doc.line(n))
  }
  return [...lines.values()].sort((a, b) => a.number - b.number)
}

/**
 * Ctrl+/: uncomments when every non-blank selected line is commented (`//` or `#`), else adds
 * `// ` at the common indentation of the non-blank lines.
 */
export const toggleJsonComment: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false
  const lines = selectedLines(state)
  const filled = lines.filter((line) => line.text.trim() !== '')
  const targets = filled.length > 0 ? filled : lines
  const changes: ChangeSpec[] = []
  const commented = filled.length > 0 && filled.every((line) => COMMENTED.test(line.text))
  if (commented) {
    for (const line of filled) {
      const match = COMMENTED.exec(line.text)
      if (match)
        changes.push({ from: line.from + match[1].length, to: line.from + match[0].length })
    }
  } else {
    const indent = Math.min(...targets.map((line) => /^[ \t]*/.exec(line.text)?.[0].length ?? 0))
    for (const line of targets) changes.push({ from: line.from + indent, insert: '// ' })
  }
  dispatch(
    state.update({
      changes,
      scrollIntoView: true,
      userEvent: commented ? 'uncomment' : 'comment'
    })
  )
  return true
}

const commentMark = Decoration.mark({ class: 'cm-json-comment' })

function commentDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { doc } = view.state
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = doc.lineAt(pos)
      const start = jsonLineCommentStart(line.text)
      if (start >= 0) builder.add(line.from + start, line.to, commentMark)
      pos = line.to + 1
    }
  }
  return builder.finish()
}

const commentHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = commentDecorations(view)
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = commentDecorations(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
)

/** Ctrl+/ toggling (`//` and `#`) + greyed-out comments. */
export const jsonComments: Extension = [
  jsonLanguage.data.of({ commentTokens: { line: '//' } }),
  Prec.high(keymap.of([{ key: 'Mod-/', run: toggleJsonComment }])),
  commentHighlight
]
