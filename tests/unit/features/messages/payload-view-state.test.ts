/**
 * UX-05: a format picked in the message detail belongs to that message; the next message is
 * shown with the connection's format again (and as its payload, not a diff).
 */
import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope, type Ref } from 'vue'
import {
  usePayloadViewState,
  type PayloadViewState
} from '@/features/messages/composables/usePayloadViewState'

function setup(initialId = 1): { id: Ref<number>; state: PayloadViewState; scope: EffectScope } {
  const id = ref(initialId)
  const scope = effectScope()
  const state = scope.run(() => usePayloadViewState(id))
  if (!state) throw new Error('no scope')
  return { id, state, scope }
}

describe('usePayloadViewState', () => {
  it('follows the connection format until a format is picked', () => {
    const { state, scope } = setup()
    expect(state.localFormat.value).toBeNull()
    expect(state.mode.value).toBe('payload')
    state.setFormat('msgpack')
    expect(state.localFormat.value).toBe('msgpack')
    scope.stop()
  })

  it('resets the format and the mode when another message is selected', async () => {
    const { id, state, scope } = setup()
    state.setFormat('msgpack')
    state.setMode('diff')
    id.value = 2
    await nextTick()
    expect(state.localFormat.value).toBeNull()
    expect(state.mode.value).toBe('payload')
    scope.stop()
  })

  it('keeps the choice while the same message stays selected', async () => {
    const { id, state, scope } = setup(5)
    state.setFormat('hex')
    id.value = 5
    await nextTick()
    expect(state.localFormat.value).toBe('hex')
    scope.stop()
  })

  it('ignores values that are not formats or modes', () => {
    const { state, scope } = setup()
    state.setFormat('nonsense')
    state.setFormat(undefined)
    state.setMode('')
    expect(state.localFormat.value).toBeNull()
    expect(state.mode.value).toBe('payload')
    scope.stop()
  })
})
