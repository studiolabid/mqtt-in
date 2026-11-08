<script setup lang="ts">
/**
 * CodeMirror 6 editor (JSON / plain text) with a `v-model` string.
 *
 * The view is created once; language, read-only, wrapping, gutters, placeholder and template
 * support are reconfigured through compartments. External `v-model` changes are applied as a
 * minimal diff so the cursor survives, and identical values are ignored. The host element is
 * borderless: wrap it in a container that draws the border and focus ring.
 */
import { onBeforeUnmount, onMounted, ref, watch, type HTMLAttributes } from 'vue'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { bracketMatching, foldKeymap, indentOnInput } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import {
  Annotation,
  Compartment,
  EditorState,
  Prec,
  Transaction,
  type Extension
} from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  type ViewUpdate
} from '@codemirror/view'
import { cn } from '@/lib/utils'
import {
  gutterExtension,
  labelExtension,
  languageExtension,
  minimalChange,
  placeholderExtension,
  plainContentAttributes,
  readonlyExtension,
  type CodeEditorLanguage
} from './lib/editor/extensions'
import { templateExtension } from './lib/editor/templates'
import { editorAppearance } from './lib/editor/theme'
import './syntax.css'

const props = withDefaults(
  defineProps<{
    /** Syntax mode. */
    language?: CodeEditorLanguage
    readonly?: boolean
    placeholder?: string
    lineNumbers?: boolean
    /** Soft-wrap long lines. */
    wrap?: boolean
    /** CSS length, e.g. `5rem`. */
    minHeight?: string
    /** CSS length; the editor scrolls beyond it. Unset = grow with the content. */
    maxHeight?: string
    autofocus?: boolean
    /** Highlight `{{template}}` tokens and complete them after typing `{{`. */
    templates?: boolean
    /** Accessible name of the content (e.g. `Payload`). */
    label?: string
    class?: HTMLAttributes['class']
  }>(),
  {
    language: 'text',
    readonly: false,
    lineNumbers: false,
    wrap: true,
    minHeight: '5rem',
    autofocus: false,
    templates: false
  }
)

const model = defineModel<string>({ default: '' })

const emit = defineEmits<{
  /** Mod-Enter (Ctrl+Enter / ⌘↵). */
  submit: []
  focus: []
  blur: []
}>()

const host = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null

/** Marks transactions that mirror an external v-model change (not echoed back). */
const External = Annotation.define<boolean>()

const compartments = {
  language: new Compartment(),
  gutter: new Compartment(),
  wrap: new Compartment(),
  readonly: new Compartment(),
  placeholder: new Compartment(),
  templates: new Compartment(),
  label: new Compartment()
}

const submitKeymap = Prec.highest(
  keymap.of([
    {
      key: 'Mod-Enter',
      preventDefault: true,
      run: () => {
        emit('submit')
        return true
      }
    }
  ])
)

function onUpdate(update: ViewUpdate): void {
  if (update.docChanged && !update.transactions.some((tr) => tr.annotation(External))) {
    model.value = update.state.doc.toString()
  }
  if (update.focusChanged) {
    if (update.view.hasFocus) emit('focus')
    else emit('blur')
  }
}

function extensions(): Extension[] {
  return [
    submitKeymap,
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightSelectionMatches(),
    highlightActiveLine(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap
    ]),
    editorAppearance,
    plainContentAttributes,
    compartments.language.of(languageExtension(props.language)),
    compartments.gutter.of(gutterExtension(props.lineNumbers, props.language)),
    compartments.wrap.of(props.wrap ? EditorView.lineWrapping : []),
    compartments.readonly.of(readonlyExtension(props.readonly)),
    compartments.placeholder.of(placeholderExtension(props.placeholder)),
    compartments.templates.of(templateExtension(props.templates, props.readonly)),
    compartments.label.of(labelExtension(props.label)),
    EditorView.updateListener.of(onUpdate)
  ]
}

function reconfigure(compartment: Compartment, extension: Extension): void {
  view?.dispatch({ effects: compartment.reconfigure(extension) })
}

onMounted(() => {
  if (!host.value) return
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({ doc: model.value ?? '', extensions: extensions() })
  })
  if (props.autofocus) view.focus()
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

watch(model, (value) => {
  if (!view) return
  const change = minimalChange(view.state.doc.toString(), value ?? '')
  if (!change) return
  view.dispatch({
    changes: change,
    annotations: [External.of(true), Transaction.addToHistory.of(!props.readonly)]
  })
})

watch(
  () => props.language,
  (language) => {
    reconfigure(compartments.language, languageExtension(language))
    reconfigure(compartments.gutter, gutterExtension(props.lineNumbers, language))
  }
)
watch(
  () => props.lineNumbers,
  (show) => reconfigure(compartments.gutter, gutterExtension(show, props.language))
)
watch(
  () => props.wrap,
  (wrap) => reconfigure(compartments.wrap, wrap ? EditorView.lineWrapping : [])
)
watch(
  () => props.readonly,
  (readonly) => {
    reconfigure(compartments.readonly, readonlyExtension(readonly))
    reconfigure(compartments.templates, templateExtension(props.templates, readonly))
  }
)
watch(
  () => props.templates,
  (enabled) => reconfigure(compartments.templates, templateExtension(enabled, props.readonly))
)
watch(
  () => props.placeholder,
  (text) => reconfigure(compartments.placeholder, placeholderExtension(text))
)
watch(
  () => props.label,
  (label) => reconfigure(compartments.label, labelExtension(label))
)

/**
 * Replaces the selection with `text` (at the cursor), focuses the editor and selects
 * `[select.from, select.to)` (offsets inside `text`), or puts the cursor after the text.
 *
 * @returns false before the editor is mounted.
 */
function insert(text: string, select?: { from: number; to: number }): boolean {
  if (!view) return false
  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, to, insert: text },
    selection: select
      ? { anchor: from + select.from, head: from + select.to }
      : { anchor: from + text.length },
    scrollIntoView: true,
    userEvent: 'input.paste'
  })
  view.focus()
  return true
}

defineExpose({
  /** Moves keyboard focus into the editor. */
  focus: (): void => view?.focus(),
  insert
})
</script>

<template>
  <div
    ref="host"
    data-slot="code-editor"
    :class="cn('min-w-0 font-mono', props.class)"
    :style="{ '--cm-min-height': minHeight, '--cm-max-height': maxHeight ?? 'none' }"
  />
</template>
