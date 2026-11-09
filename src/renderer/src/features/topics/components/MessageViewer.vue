<script setup lang="ts">
/**
 * A message with its metadata line and actions (view format, copy value, edit & publish), its
 * MQTT 5 properties and the payload — or the diff against the previous message.
 *
 * The view format picked here is local to the viewer (`useViewerFormat`): it never changes the
 * Messages tab. A topic's last value can be a 64 KiB copy once the buffer evicted a large
 * message (`fullBytes` is the original size): the metadata shows the original size and a note
 * above the payload says that only its start is shown.
 *
 * With `live` (a topic's last value) the lines a newer message on the same topic changed are
 * marked for a moment; switching topic or view format replaces the text without marking.
 */
import { computed, ref, watch } from 'vue'
import { CopyIcon, ScissorsIcon, SquarePenIcon } from '@lucide/vue'
import type { MqttMessage } from '@shared/models'
import { decodePayload } from '@shared/payload'
import { PayloadDiff, PayloadView } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCopy } from '@/composables/useCopy'
import { useSettingsStore } from '@/stores/settings'
import { formatBytes } from '@/utils/format'
import { useTopicActions } from '../composables/useTopicActions'
import { useViewerFormat } from '../composables/useViewerFormat'
import MessageMeta from './MessageMeta.vue'
import MessageProperties from './MessageProperties.vue'
import MessageTime from './MessageTime.vue'
import ViewFormatSelect from './ViewFormatSelect.vue'

const props = withDefaults(
  defineProps<{
    connectionId: string
    message: MqttMessage
    /** Previous message on the topic (for the diff). */
    previous?: MqttMessage
    /** Show the diff against `previous` instead of the payload. */
    diff?: boolean
    /** Original payload size when `message` may hold a cut copy (a topic's last value). */
    fullBytes?: number
    /** `message` follows the topic's latest value: mark what each update changed. */
    live?: boolean
  }>(),
  { diff: false, previous: undefined, fullBytes: undefined, live: false }
)

const settings = useSettingsStore()
const actions = useTopicActions(() => props.connectionId)
const { copy } = useCopy()

const format = useViewerFormat(
  () => props.connectionId,
  () => props.message.topic
)

/**
 * True while the shown payload is a newer message on the same topic in the same format.
 * Sync, so it is settled before the payload reaches the editor in the same render.
 */
const flash = ref(false)
watch(
  [() => props.message, format],
  ([message, current], [previous, previousFormat]) => {
    flash.value =
      props.live &&
      message !== previous &&
      message.topic === previous.topic &&
      current === previousFormat
  },
  { flush: 'sync' }
)

/** 'Showing the first 64 KB of 2.5 MB' when the value is a cut copy. */
const truncatedNote = computed(() => {
  const full = props.fullBytes
  const kept = props.message.payload.byteLength
  if (full === undefined || kept >= full) return null
  return `Showing the first ${formatBytes(kept, 0)} of ${formatBytes(full)}`
})

function copyValue(): void {
  void copy(decodePayload(props.message.payload, format.value, { pretty: true }).text, 'value')
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div
      class="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b py-1 pr-2 pl-3"
    >
      <MessageMeta :message="message" :bytes="fullBytes" class="mr-auto" />
      <div class="flex items-center gap-0.5">
        <ViewFormatSelect v-model="format" class="mr-1" />
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-muted-foreground"
              aria-label="Copy value"
              @click="copyValue"
            >
              <CopyIcon aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy value</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-muted-foreground"
              aria-label="Edit and publish"
              @click="actions.editAndPublish(message)"
            >
              <SquarePenIcon aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit &amp; publish</TooltipContent>
        </Tooltip>
      </div>
    </div>
    <div class="min-h-0 flex-1 space-y-3 overflow-auto p-3 scrollbar-slim">
      <p
        v-if="truncatedNote && !diff"
        data-testid="topic-value-truncated"
        class="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums"
      >
        <ScissorsIcon class="size-3.5 shrink-0" aria-hidden="true" />
        {{ truncatedNote }}
      </p>
      <MessageProperties :properties="message.properties" />
      <PayloadDiff
        v-if="diff"
        :current="message"
        :previous="previous"
        :format="format"
        :wrap="settings.settings.wordWrap"
      >
        <template #time="{ timestamp }">
          <MessageTime :timestamp="timestamp" class="text-foreground" />
        </template>
      </PayloadDiff>
      <PayloadView
        v-else
        :payload="message.payload"
        :format="format"
        :wrap="settings.settings.wordWrap"
        :flash-changes="flash"
      />
    </div>
  </div>
</template>
