/**
 * View format of the topic explorer's message viewer (HEALTH-08). A format picked there stays
 * in the viewer: it never changes the Messages tab (the list previews and the message detail
 * follow `ui.viewFormat(connectionId)`, which this never writes). It defaults to that
 * connection format and lasts while the same topic is shown (browsing its history keeps it).
 */
import { computed, ref, watch, type WritableComputedRef } from 'vue'
import type { ViewFormat } from '@shared/models'
import { useUiStore } from '@/stores/ui'

export function useViewerFormat(
  connectionId: () => string,
  topic: () => string
): WritableComputedRef<ViewFormat> {
  const ui = useUiStore()
  /** `null` follows the connection's view format. */
  const local = ref<ViewFormat | null>(null)

  watch([connectionId, topic], () => {
    local.value = null
  })

  return computed<ViewFormat>({
    get: () => local.value ?? ui.viewFormat(connectionId()),
    set: (value) => {
      local.value = value
    }
  })
}
