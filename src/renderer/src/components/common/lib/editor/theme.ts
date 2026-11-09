import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

/** `color-mix` of a theme token with transparency, e.g. `tint('--primary', 20)`. */
const tint = (token: string, percent: number): string =>
  `color-mix(in oklab, var(${token}) ${percent}%, transparent)`

/**
 * Editor chrome built only on the app's CSS variables, so light / dark / accent switches
 * apply instantly without reconfiguring the view. Selectors mirror CodeMirror's base theme
 * so these rules win on specificity. The host element provides the font (`font-mono`), the
 * border and the focus ring; `--cm-min-height` / `--cm-max-height` size the scroller.
 */
export const editorTheme: Extension = EditorView.theme({
  '&': {
    color: 'var(--foreground)',
    backgroundColor: 'transparent',
    fontSize: '12.5px',
    height: '100%',
    maxHeight: 'var(--cm-max-height, none)'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.6',
    minHeight: 'var(--cm-min-height, 0px)',
    overflow: 'auto'
  },
  '.cm-content': { padding: '6px 0', caretColor: 'var(--primary)' },
  '.cm-line': { padding: '0 10px', transition: 'background-color 200ms ease-out' },
  '.cm-cursor, .cm-dropCursor': {
    borderLeft: '1.5px solid var(--primary)',
    marginLeft: '-0.75px'
  },
  '&.cm-readonly .cm-cursorLayer': { display: 'none' },
  '.cm-selectionBackground': { background: tint('--muted-foreground', 18) },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    background: tint('--primary', 24)
  },
  '.cm-activeLine': { backgroundColor: tint('--muted-foreground', 7) },
  '&:not(.cm-focused) .cm-activeLine': { backgroundColor: 'transparent' },
  // Line numbers and fold markers are read: full muted text (>= 4.5:1), no transparency.
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--muted-foreground)',
    border: 'none'
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 4px 0 10px',
    minWidth: '28px',
    fontVariantNumeric: 'tabular-nums'
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-activeLineGutter': { color: 'var(--foreground)' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px 0 2px' },
  '.cm-fold-marker': {
    display: 'inline-flex',
    alignItems: 'center',
    height: '100%',
    color: 'var(--muted-foreground)',
    cursor: 'pointer',
    '&:hover': { color: 'var(--foreground)' }
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--muted)',
    border: 'none',
    borderRadius: '4px',
    color: 'var(--muted-foreground)',
    margin: '0 2px',
    padding: '0 5px'
  },
  '.cm-placeholder': { color: 'var(--muted-foreground)' },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: tint('--primary', 16),
    outline: `1px solid ${tint('--primary', 40)}`,
    borderRadius: '2px'
  },
  '&.cm-focused .cm-nonmatchingBracket': {
    backgroundColor: tint('--destructive', 16),
    color: 'var(--destructive)'
  },
  '.cm-selectionMatch': { backgroundColor: tint('--warning', 22), borderRadius: '2px' },
  '.cm-searchMatch': {
    backgroundColor: tint('--warning', 28),
    outline: `1px solid ${tint('--warning', 55)}`,
    borderRadius: '2px'
  },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: tint('--warning', 55) },
  // Lines a live update changed (lib/editor/change-flash.ts); wins over the active line.
  '.cm-line.cm-changedLine': { backgroundColor: tint('--warning', 18) },
  '.cm-specialChar': { color: 'var(--destructive)' },
  '.cm-template': {
    color: 'var(--primary)',
    backgroundColor: tint('--primary', 10),
    borderRadius: '3px',
    boxShadow: `0 0 0 1px ${tint('--primary', 22)}`
  },
  '.cm-panels': { backgroundColor: 'var(--popover)', color: 'var(--popover-foreground)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel.cm-search': { padding: '6px 28px 6px 8px', fontSize: '12px' },
  '.cm-panel.cm-search label': { fontSize: '11px', color: 'var(--muted-foreground)' },
  '.cm-panel.cm-search [name=close]': {
    top: '5px',
    right: '8px',
    color: 'var(--muted-foreground)',
    fontSize: '16px',
    lineHeight: '1',
    cursor: 'pointer'
  },
  '.cm-textfield': {
    backgroundColor: 'transparent',
    border: '1px solid var(--input)',
    borderRadius: '6px',
    color: 'inherit',
    fontSize: '12px',
    height: '24px',
    padding: '0 6px',
    outline: 'none',
    '&:focus': {
      borderColor: 'var(--ring)',
      boxShadow: `0 0 0 3px ${tint('--ring', 30)}`
    }
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--secondary)',
    color: 'var(--secondary-foreground)',
    border: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    height: '24px',
    padding: '0 8px',
    cursor: 'pointer',
    '&:hover': { backgroundColor: tint('--secondary-foreground', 12) },
    '&:active': { backgroundImage: 'none' }
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    boxShadow: `0 8px 24px -8px ${tint('--foreground', 25)}`,
    overflow: 'hidden'
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'inherit',
    maxHeight: '15em',
    minWidth: '240px',
    padding: '4px'
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    borderRadius: '5px',
    lineHeight: '1.5',
    padding: '2px 8px'
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    background: 'var(--accent)',
    color: 'var(--accent-foreground)'
  },
  '.cm-completionDetail': {
    color: 'var(--muted-foreground)',
    fontStyle: 'normal',
    marginLeft: '12px'
  },
  '.cm-completionMatchedText': { color: 'var(--primary)', textDecoration: 'none' }
})

/**
 * Syntax colors. The `--syntax-*` variables are defined (per light / dark) in `syntax.css`
 * and shared with `JsonInline`.
 */
export const editorHighlightStyle = HighlightStyle.define([
  { tag: t.propertyName, color: 'var(--syntax-key)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syntax-string)' },
  { tag: [t.number, t.integer, t.float], color: 'var(--syntax-number)' },
  { tag: [t.bool, t.keyword], color: 'var(--syntax-bool)' },
  { tag: t.null, color: 'var(--syntax-null)', fontStyle: 'italic' },
  {
    tag: [t.punctuation, t.separator, t.brace, t.squareBracket, t.bracket],
    color: 'var(--syntax-punct)'
  },
  { tag: t.comment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
  { tag: t.invalid, color: 'var(--destructive)' }
])

/** Theme + highlighting as one extension. */
export const editorAppearance: Extension = [editorTheme, syntaxHighlighting(editorHighlightStyle)]
