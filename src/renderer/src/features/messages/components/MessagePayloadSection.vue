<script setup lang="ts">
/**
 * Payload of the selected message: a view format picked here (reset for every message, see
 * `usePayloadViewState`; it defaults to the connection's), word wrap (defaults to the setting),
 * copy, and "Diff" against the previous message on the same topic and direction when the
 * payload is text-like. When the format shown cannot decode the payload, "Show as Auto" offers
 * the way back. The viewer is at least ~8 lines tall, so short and long payloads share a frame.
 */
import { computed, ref } from 'vue'
import { CopyIcon, GitCompareArrowsIcon, WrapTextIcon } from '@lucide/vue'
import type { MqttMessage, ViewFormat } from '@shared/models'
import { decodePayload, VIEW_FORMATS } from '@shared/payload'
import { IconButton, PayloadDiff, PayloadView } from '@/components/common'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMessagesStore, useSettingsStore, useUiStore } from '@/stores'
import { useMessageActions } from '../composables/useMessageActions'
import { usePayloadViewState } from '../composables/usePayloadViewState'
import { indexOfId } from '../utils/message-index'

/** The viewer decodes at most this much (PayloadView's limit). */
const VIEW_MAX_BYTES = 1024 * 1024

const props = defineProps<{
  connectionId: string
  message: MqttMessage
}>()

const ui = useUiStore()
const settings = useSettingsStore()
const messages = useMessagesStore()
const actions = useMessageActions(() => props.connectionId)

const view = usePayloadViewState(() => props.message.id)
const format = computed<ViewFormat>(
  () => view.localFormat.value ?? ui.viewFormat(props.connectionId)
)
const wrap = ref(settings.settings.wordWrap)

/** JSON / text (or a binary codec shown as JSON): a line diff makes sense. */
const textLike = computed(() => {
  const value = format.value
  if (value === 'hex' || value === 'base64') return false
  if (value !== 'auto') return true
  return (
    decodePayload(props.message.payload, 'auto', { pretty: false, maxBytes: 4096 }).format !== 'hex'
  )
})

/** The format shown is forced and cannot decode the payload (the viewer shows the error). */
const undecodable = computed(() => {
  const value = format.value
  if (value === 'auto' || props.message.payload.length === 0) return false
  const decoded = decodePayload(props.message.payload, value, {
    pretty: false,
    maxBytes: VIEW_MAX_BYTES
  })
  return decoded.error !== undefined
})

/** Previous message of the same topic and direction (from the topic history). */
const previous = computed<MqttMessage | null>(() => {
  if (!textLike.value) return null
  const current = props.message
  const history = messages.topicHistory(props.connectionId, current.topic)
  const index = indexOfId(history, current.id)
  for (let i = index - 1; i >= 0; i--) {
    if (history[i].direction === current.direction) return history[i]
  }
  return null
})

const showDiff = computed(() => view.mode.value === 'diff' && previous.value !== null)

const LABEL = 'text-[10px] font-medium tracking-wider text-muted-foreground uppercase'
</script>

<template>
  <section class="flex min-w-0 flex-col gap-2">
    <div class="flex min-h-7 min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
      <h3 :class="LABEL">Payload</h3>
      <ToggleGroup
        v-if="previous"
        type="single"
        variant="outline"
        size="sm"
        :model-value="showDiff ? 'diff' : 'payload'"
        aria-label="Payload or diff"
        @update:model-value="view.setMode"
      >
        <ToggleGroupItem
          value="payload"
          class="h-6 px-2 text-xs text-muted-foreground data-[state=on]:text-foreground"
        >
          Payload
        </ToggleGroupItem>
        <ToggleGroupItem
          value="diff"
          title="Compare with the previous message on this topic"
          class="h-6 gap-1 px-2 text-xs text-muted-foreground data-[state=on]:text-foreground"
        >
          <GitCompareArrowsIcon class="size-3.5" aria-hidden="true" />
          Diff
        </ToggleGroupItem>
      </ToggleGroup>
      <div class="ml-auto flex shrink-0 items-center gap-0.5">
        <Button
          v-if="undecodable"
          data-testid="message-detail-show-auto"
          variant="link"
          size="xs"
          class="h-7 px-1.5"
          @click="view.localFormat.value = 'auto'"
        >
          Show as Auto
        </Button>
        <Select :model-value="format" @update:model-value="view.setFormat">
          <SelectTrigger size="sm" aria-label="View payload as" class="min-w-22 px-2 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectItem v-for="item in VIEW_FORMATS" :key="item.value" :value="item.value">
              {{ item.label }}
            </SelectItem>
          </SelectContent>
        </Select>
        <Tooltip>
          <TooltipTrigger as-child>
            <Toggle
              size="sm"
              :model-value="wrap"
              aria-label="Wrap long lines"
              class="size-7 min-w-7 px-0 text-muted-foreground hover:text-foreground aria-pressed:text-foreground"
              @update:model-value="(value) => (wrap = value)"
            >
              <WrapTextIcon aria-hidden="true" />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Wrap long lines</TooltipContent>
        </Tooltip>
        <IconButton label="Copy payload" @click="actions.copyPayload(message, format, true)">
          <CopyIcon />
        </IconButton>
      </div>
    </div>
    <PayloadDiff
      v-if="showDiff && previous"
      data-testid="message-detail-payload"
      data-mode="diff"
      :previous="previous"
      :current="message"
      :format="format"
      :wrap="wrap"
      body-class="max-h-[min(60vh,36rem)]"
    />
    <PayloadView
      v-else
      data-testid="message-detail-payload"
      data-mode="payload"
      :payload="message.payload"
      :format="format"
      :wrap="wrap"
      max-height="min(60vh, 36rem)"
      class="min-h-43"
    />
  </section>
</template>
