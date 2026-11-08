/**
 * Per-connection view state of the topic explorer that must survive remounts (switching
 * workspace tabs or connections): expanded nodes, search, detail tab, chart preferences, the
 * pinned-values chart.
 *
 * It lives at module level because the core `useUiStore` has no slot for it; everything here is
 * display state only (no message data). It is dropped with a deleted connection
 * (`onConnectionRemoved`, CT-11). Candidate for promotion into the ui store.
 */
import { reactive, ref, type Ref } from 'vue'
import { onConnectionRemoved } from '@/stores/connection-lifecycle'
import type { ChartWindowId } from '../utils/chart-data'

export type DetailTab = 'value' | 'history' | 'chart' | 'subtopics'
export type ChartLayout = 'overlay' | 'split'

export interface TopicExplorerState {
  /** Topics of expanded tree nodes (reactive, mutate in place). */
  readonly expanded: Set<string>
  readonly search: Ref<string>
  /** The tab the user last picked (see `resolveDetailTab` for the one shown). */
  readonly detailTab: Ref<DetailTab>
  readonly historyDiff: Ref<boolean>
  readonly chartWindow: Ref<ChartWindowId>
  readonly chartLayout: Ref<ChartLayout>
  /** The detail area shows one chart of every pinned value instead of the topic. */
  readonly pinnedChart: Ref<boolean>
  readonly pinnedWindow: Ref<ChartWindowId>
  /** Tree scroll offset in px (not reactive: only read when the tree mounts). */
  scrollTop: number
  /**
   * The topic the tree itself selected last. Any other selection came from elsewhere (e.g.
   * "show in topic tree") and is revealed by expanding its ancestors.
   */
  treeSelection: string | null
  /** Small trees are expanded automatically until the user collapses something. */
  autoExpand: boolean
}

/** Chart field selections remembered per connection (most recently used topics). */
const MAX_REMEMBERED_TOPICS = 64

const states = new Map<string, TopicExplorerState>()
const chartFields = new Map<string, Map<string, ReadonlyMap<string, number>>>()

onConnectionRemoved((connectionId) => {
  states.delete(connectionId)
  chartFields.delete(connectionId)
})

/** The explorer state of a connection (created on first use). */
export function topicExplorerState(connectionId: string): TopicExplorerState {
  let state = states.get(connectionId)
  if (!state) {
    state = {
      expanded: reactive(new Set<string>()),
      search: ref(''),
      detailTab: ref<DetailTab>('value'),
      historyDiff: ref(false),
      chartWindow: ref<ChartWindowId>('all'),
      chartLayout: ref<ChartLayout>('overlay'),
      pinnedChart: ref(false),
      pinnedWindow: ref<ChartWindowId>('all'),
      scrollTop: 0,
      treeSelection: null,
      autoExpand: true
    }
    states.set(connectionId, state)
  }
  return state
}

/** Selected chart fields of a topic (field → palette slot), if any were chosen before. */
export function rememberedChartFields(
  connectionId: string,
  topic: string
): ReadonlyMap<string, number> | undefined {
  return chartFields.get(connectionId)?.get(topic)
}

export function rememberChartFields(
  connectionId: string,
  topic: string,
  fields: ReadonlyMap<string, number>
): void {
  let byTopic = chartFields.get(connectionId)
  if (!byTopic) {
    byTopic = new Map()
    chartFields.set(connectionId, byTopic)
  }
  byTopic.delete(topic)
  byTopic.set(topic, fields) // most recently used last
  if (byTopic.size > MAX_REMEMBERED_TOPICS) {
    const oldest = byTopic.keys().next().value
    if (oldest !== undefined) byTopic.delete(oldest)
  }
}

export interface DetailTabContext {
  /** The selected topic. */
  topic: string
  /** The node has children (the Subtopics tab exists). */
  hasChildren: boolean
  /** The topic's latest payload holds numbers (something to chart). */
  numeric: boolean
  /** The topic for which the user picked `preferred` in this view, if any. */
  pickedFor: string | null
}

/**
 * The detail tab to show (UX-18), without changing the stored preference: a Chart preference
 * shows Value for a topic without numbers (unless the user picked Chart on that very topic),
 * and Subtopics needs children. Numeric topics therefore still reopen on Chart.
 */
export function resolveDetailTab(preferred: DetailTab, context: DetailTabContext): DetailTab {
  if (preferred === 'subtopics' && !context.hasChildren) return 'value'
  if (preferred === 'chart' && !context.numeric && context.pickedFor !== context.topic) {
    return 'value'
  }
  return preferred
}
