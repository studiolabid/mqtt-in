/**
 * The heavy common components, loaded on first use (CT-20): `CodeEditor` (CodeMirror),
 * `TimeSeriesChart` (uPlot) and `PayloadDiff` (diff). Exported from the `@/components/common`
 * barrel in place of the SFCs, so nothing on the welcome screen pulls them into the startup
 * bundle. Props, emits and slots are the components' own.
 *
 * While a chunk loads, a placeholder of about the final height is shown (no layout shift).
 * Template refs point to that placeholder until the component has loaded, then to the
 * component: the `CodeEditor` placeholder exposes no-op `focus()` and `insert()` (returns
 * false, as the editor does before it is mounted), so `editor.value?.insert(…)` stays safe.
 */
import {
  defineAsyncComponent,
  defineComponent,
  h,
  type Component,
  type FunctionalComponent
} from 'vue'

/** CodeMirror metrics (lib/editor/theme.ts): 12.5px font × 1.6 line height, 6px padding. */
const EDITOR_LINE_PX = 20
const EDITOR_PADDING_PX = 12
/** Lines estimated at most (beyond that the editor scrolls or the max height applies). */
const EDITOR_MAX_LINES = 40

function lineCount(text: unknown): number {
  if (typeof text !== 'string' || text.length === 0) return 1
  let lines = 1
  for (
    let i = text.indexOf('\n');
    i !== -1 && lines < EDITOR_MAX_LINES;
    i = text.indexOf('\n', i + 1)
  ) {
    lines++
  }
  return lines
}

/** Where the editor will be, at about its height (min / max height and line count). */
const EditorPlaceholder = defineComponent({
  name: 'CodeEditorLoading',
  inheritAttrs: false,
  props: {
    modelValue: { type: String, default: '' },
    minHeight: { type: String, default: '5rem' },
    maxHeight: { type: String, default: undefined }
  },
  setup(props, { attrs, expose }) {
    expose({ focus: (): void => {}, insert: (): boolean => false })
    return () => {
      const estimate = `${lineCount(props.modelValue) * EDITOR_LINE_PX + EDITOR_PADDING_PX}px`
      const max = props.maxHeight ? `, ${props.maxHeight}` : ''
      return h('div', {
        class: ['min-w-0 font-mono', attrs.class],
        style: [{ height: `max(${props.minHeight}, min(${estimate}${max}))` }, attrs.style],
        'data-slot': 'code-editor-loading',
        'aria-busy': 'true'
      })
    }
  }
})

/** A block of a fixed height while a component loads (functional: no state of its own). */
function blockPlaceholder(slot: string, height: (props: { height: number }) => string): Component {
  const placeholder: FunctionalComponent<{ height: number }> = (props, { attrs }) =>
    h('div', {
      class: ['min-w-0', attrs.class],
      style: [{ height: height(props) }, attrs.style],
      'data-slot': slot,
      'aria-busy': 'true'
    })
  placeholder.props = { height: { type: Number, default: 0 } }
  placeholder.inheritAttrs = false
  return placeholder
}

/** TimeSeriesChart's default total height (legend included), in px. */
const CHART_DEFAULT_HEIGHT = 220
/** Height of the diff placeholder (the diff itself grows with its content). */
const DIFF_PLACEHOLDER_HEIGHT = '6rem'

export const CodeEditor = defineAsyncComponent({
  loader: () => import('./CodeEditor.vue'),
  loadingComponent: EditorPlaceholder,
  delay: 0
})

export const TimeSeriesChart = defineAsyncComponent({
  loader: () => import('./TimeSeriesChart.vue'),
  loadingComponent: blockPlaceholder(
    'time-series-chart-loading',
    (props) => `${props.height > 0 ? props.height : CHART_DEFAULT_HEIGHT}px`
  ),
  delay: 0
})

export const PayloadDiff = defineAsyncComponent({
  loader: () => import('./PayloadDiff.vue'),
  loadingComponent: blockPlaceholder('payload-diff-loading', () => DIFF_PLACEHOLDER_HEIGHT),
  delay: 0
})
