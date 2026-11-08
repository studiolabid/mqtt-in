/**
 * Auto-scroll of the message list per connection: defaults to `settings.autoScroll`, a toggle
 * in the toolbar overrides it for that connection for the rest of the app session (the state
 * survives switching connections, which remounts the workspace). The override of a deleted
 * connection is dropped (`onConnectionRemoved`, CT-11).
 */
import { computed, reactive, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import { onConnectionRemoved, useSettingsStore } from '@/stores'

/** Connection id → explicit choice (only stored when it differs from the setting). */
const overrides = reactive(new Map<string, boolean>())
onConnectionRemoved((connectionId) => overrides.delete(connectionId))

export interface AutoScroll {
  enabled: ComputedRef<boolean>
  set(value: boolean): void
  toggle(): void
}

export function useAutoScroll(connectionId: MaybeRefOrGetter<string>): AutoScroll {
  const settings = useSettingsStore()

  const enabled = computed(
    () => overrides.get(toValue(connectionId)) ?? settings.settings.autoScroll
  )

  function set(value: boolean): void {
    const id = toValue(connectionId)
    if (value === settings.settings.autoScroll) overrides.delete(id)
    else overrides.set(id, value)
  }

  return { enabled, set, toggle: () => set(!enabled.value) }
}
