/**
 * Focusing the payload editor, also on request from other features
 * (`useUiStore().requestPublishFocus`). While the parent keeps the panel collapsed the request
 * waits (up to a second) for the workspace to expand it, so focus lands in a visible editor.
 */
import { nextTick, watch, type Ref } from 'vue'
import { useTimeoutFn } from '@vueuse/core'
import { useUiStore } from '@/stores'

const PENDING_FOCUS_MS = 1_000

export function useEditorFocus(options: {
  connectionId: () => string
  editor: Readonly<Ref<{ focus(): void } | null>>
  collapsed: Readonly<Ref<boolean>>
}): { focusEditor(): void } {
  const ui = useUiStore()
  let pending = false
  const { start: expirePending } = useTimeoutFn(() => (pending = false), PENDING_FOCUS_MS, {
    immediate: false
  })

  function focusEditor(): void {
    if (options.collapsed.value) {
      pending = true
      expirePending()
      return
    }
    void nextTick(() => requestAnimationFrame(() => options.editor.value?.focus()))
  }

  watch(options.collapsed, (collapsed) => {
    if (collapsed || !pending) return
    pending = false
    focusEditor()
  })

  watch(
    () => ui.publishFocusRequest(options.connectionId()),
    () => focusEditor()
  )

  return { focusEditor }
}
