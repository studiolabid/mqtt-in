import { json } from '@codemirror/lang-json'
import { foldGutter } from '@codemirror/language'
import { EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  highlightActiveLineGutter,
  lineNumbers,
  placeholder as placeholderExt
} from '@codemirror/view'

/** Languages supported by `CodeEditor`. */
export type CodeEditorLanguage = 'json' | 'text'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Chevron used by the fold gutter (lucide `chevron-down` / `chevron-right` geometry). */
function foldMarker(open: boolean): HTMLElement {
  const wrapper = document.createElement('span')
  wrapper.className = 'cm-fold-marker'
  wrapper.title = open ? 'Fold' : 'Unfold'
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '12')
  svg.setAttribute('height', '12')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', open ? 'm6 9 6 6 6-6' : 'm9 18 6-6-6-6')
  svg.appendChild(path)
  wrapper.appendChild(svg)
  return wrapper
}

export function languageExtension(language: CodeEditorLanguage): Extension {
  return language === 'json' ? json() : []
}

/** Line numbers (+ fold gutter for JSON) or nothing. */
export function gutterExtension(show: boolean, language: CodeEditorLanguage): Extension {
  if (!show) return []
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    language === 'json' ? foldGutter({ markerDOM: foldMarker }) : []
  ]
}

export function readonlyExtension(readonly: boolean): Extension {
  if (!readonly) return []
  return [
    EditorState.readOnly.of(true),
    EditorView.editorAttributes.of({ class: 'cm-readonly' }),
    EditorView.contentAttributes.of({ 'aria-readonly': 'true' })
  ]
}

export function placeholderExtension(text: string | undefined): Extension {
  return text ? placeholderExt(text) : []
}

/** Accessible name of the editable content element. */
export function labelExtension(label: string | undefined): Extension {
  return label ? EditorView.contentAttributes.of({ 'aria-label': label }) : []
}

/** Static content attributes: no spell checking / auto-correction for technical text. */
export const plainContentAttributes: Extension = EditorView.contentAttributes.of({
  spellcheck: 'false',
  autocorrect: 'off',
  autocapitalize: 'off',
  translate: 'no'
})

export interface TextChange {
  from: number
  to: number
  insert: string
}

/**
 * Smallest single replacement turning `before` into `after` (common prefix / suffix are
 * kept), so CodeMirror can map the selection instead of resetting it. `null` when equal.
 */
export function minimalChange(before: string, after: string): TextChange | null {
  if (before === after) return null
  const max = Math.min(before.length, after.length)
  let start = 0
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++
  // Never split a surrogate pair.
  if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) start--
  let end = 0
  const room = max - start
  while (
    end < room &&
    before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)
  ) {
    end++
  }
  if (end > 0 && isLowSurrogate(before.charCodeAt(before.length - end))) end--
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) }
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}
