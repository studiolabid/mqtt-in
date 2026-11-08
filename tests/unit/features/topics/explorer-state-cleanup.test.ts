/**
 * HEALTH-06 / KNOWN-PRUNE: the topic explorer's per-connection state (view state and chart
 * field choices) is dropped when the connection is deleted (CT-11).
 */
import { describe, expect, it } from 'vitest'
import {
  rememberChartFields,
  rememberedChartFields,
  topicExplorerState
} from '@/features/topics/composables/explorer-state'
import { notifyConnectionRemoved } from '@/stores/connection-lifecycle'

describe('topic explorer state of a deleted connection', () => {
  it('drops the view state and the remembered chart fields', () => {
    const state = topicExplorerState('gone')
    state.search.value = 'sensors'
    state.expanded.add('home')
    state.pinnedChart.value = true
    rememberChartFields('gone', 'a/b', new Map([['temp', 0]]))
    rememberChartFields('kept', 'a/b', new Map([['hum', 1]]))
    topicExplorerState('kept').search.value = 'stay'

    notifyConnectionRemoved('gone')

    const fresh = topicExplorerState('gone')
    expect(fresh).not.toBe(state)
    expect(fresh.search.value).toBe('')
    expect(fresh.expanded.size).toBe(0)
    expect(fresh.pinnedChart.value).toBe(false)
    expect(rememberedChartFields('gone', 'a/b')).toBeUndefined()
    expect(rememberedChartFields('kept', 'a/b')?.get('hum')).toBe(1)
    expect(topicExplorerState('kept').search.value).toBe('stay')
  })
})
