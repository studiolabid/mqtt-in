/**
 * UX-18: after charting one topic, a topic without numbers opens on Value; the Chart
 * preference itself is kept, so numeric topics reopen on Chart.
 */
import { describe, expect, it } from 'vitest'
import {
  resolveDetailTab,
  topicExplorerState,
  type DetailTabContext
} from '@/features/topics/composables/explorer-state'

function context(overrides: Partial<DetailTabContext> = {}): DetailTabContext {
  return { topic: 'home/status', hasChildren: false, numeric: false, pickedFor: null, ...overrides }
}

describe('resolveDetailTab', () => {
  it('shows Value for a Chart preference on a topic without numbers, keeping the preference', () => {
    const state = topicExplorerState('tabs')
    state.detailTab.value = 'chart'
    expect(resolveDetailTab(state.detailTab.value, context())).toBe('value')
    expect(state.detailTab.value).toBe('chart')
  })

  it('shows Chart for a numeric topic', () => {
    expect(resolveDetailTab('chart', context({ topic: 'home/temp', numeric: true }))).toBe('chart')
  })

  it('keeps Chart when the user picked it on this very topic', () => {
    expect(resolveDetailTab('chart', context({ pickedFor: 'home/status' }))).toBe('chart')
    expect(resolveDetailTab('chart', context({ pickedFor: 'home/other' }))).toBe('value')
  })

  it('shows Value for Subtopics on a node without children', () => {
    expect(resolveDetailTab('subtopics', context())).toBe('value')
    expect(resolveDetailTab('subtopics', context({ hasChildren: true }))).toBe('subtopics')
  })

  it('leaves the other tabs alone', () => {
    expect(resolveDetailTab('history', context())).toBe('history')
    expect(resolveDetailTab('value', context({ numeric: true }))).toBe('value')
  })
})
