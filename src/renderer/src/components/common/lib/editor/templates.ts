import {
  autocompletion,
  pickedCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import {
  Decoration,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate
} from '@codemirror/view'
import { hasTemplate, TEMPLATE_VARIABLES } from '@shared/template'

const TOKEN = /\{\{\s*[A-Za-z]+\s*(?:\([^)]*\))?\s*\}\}/g
const templateMark = Decoration.mark({ class: 'cm-template' })

const decorator = new MatchDecorator({
  regexp: TOKEN,
  decoration: (match) => (hasTemplate(match[0]) ? templateMark : null)
})

/** Marks known `{{template}}` tokens with the `cm-template` class. */
const templateHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = decorator.createDeco(view)
    }

    update(update: ViewUpdate): void {
      this.decorations = decorator.updateDeco(update, this.decorations)
    }
  },
  { decorations: (plugin) => plugin.decorations }
)

/** Inserts a token, swallowing `}}` auto-closed by closeBrackets and selecting its arguments. */
function applyToken(token: string) {
  return (view: EditorView, completion: Completion, from: number, to: number): void => {
    const end = view.state.sliceDoc(to, to + 2) === '}}' ? to + 2 : to
    const open = token.indexOf('(')
    const close = token.lastIndexOf(')')
    const selection =
      open !== -1 && close > open + 1
        ? { anchor: from + open + 1, head: from + close }
        : { anchor: from + token.length }
    view.dispatch({
      changes: { from, to: end, insert: token },
      selection,
      annotations: pickedCompletion.of(completion)
    })
  }
}

const OPTIONS: readonly Completion[] = TEMPLATE_VARIABLES.map((variable) => ({
  label: variable.token,
  detail: variable.description,
  type: 'variable',
  apply: applyToken(variable.token)
}))

function templateCompletions(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/\{\{\s*[A-Za-z]*$/)
  if (!before) return null
  return { from: before.from, options: OPTIONS, validFor: /^\{\{\s*[A-Za-z]*$/ }
}

const templateCompletion = autocompletion({
  override: [templateCompletions],
  icons: false,
  activateOnTyping: true
})

/** Template variable support: highlighting always, completion only when editable. */
export function templateExtension(enabled: boolean, readonly: boolean): Extension {
  if (!enabled) return []
  return readonly ? templateHighlighter : [templateHighlighter, templateCompletion]
}
