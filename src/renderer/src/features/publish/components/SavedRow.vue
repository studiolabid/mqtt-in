<script setup lang="ts">
/**
 * One saved message: its name, topic (or "draft topic" when it keeps the draft's) and a payload
 * preview. The row button loads it into the draft; ▶ publishes it as it is (the draft stays) and
 * × removes it (with an undo toast). Both appear on hover / keyboard focus.
 */
import { computed } from 'vue'
import { PlayIcon, XIcon } from '@lucide/vue'
import { HintTooltip, JsonInline, QosBadge, TopicLabel } from '@/components/common'
import { Button } from '@/components/ui/button'
import type { SavedMessage } from '@/types'
import { FORMAT_META, isJsonAuthored, previewText } from '../utils/payload-tools'

const props = defineProps<{
  item: SavedMessage
  index: number
  /** Publishing is possible (connected). */
  connected: boolean
  /** QoS is shown (MQTT connections). */
  showQos?: boolean
}>()

const emit = defineEmits<{ load: []; send: []; remove: [] }>()

const preview = computed(() => previewText(props.item.payload))
const json = computed(() => isJsonAuthored(props.item.format) && preview.value !== '')

const REVEAL =
  'opacity-0 transition-opacity group-hover/row:opacity-100 group-has-[[data-row]:focus-visible]/row:opacity-100'
</script>

<template>
  <div
    data-testid="publish-saved-row"
    :data-name="item.name"
    class="group/row relative rounded-md transition-colors hover:bg-accent/60 has-[[data-row]:focus-visible]:bg-accent"
  >
    <button
      type="button"
      data-row
      :data-index="index"
      class="flex w-full min-w-0 flex-col gap-1 rounded-md px-2 py-1.5 pr-16 text-left outline-none"
      @click="emit('load')"
    >
      <span class="flex w-full min-w-0 items-center gap-2">
        <span class="shrink-0 font-mono text-xs font-medium text-foreground">{{ item.name }}</span>
        <TopicLabel v-if="item.topic" :topic="item.topic" class="min-w-0 flex-1 text-[11px]" />
        <span v-else class="min-w-0 flex-1 truncate text-[11px] text-muted-foreground italic">
          draft topic
        </span>
      </span>
      <span class="flex w-full min-w-0 items-center gap-1.5">
        <JsonInline v-if="json" :text="preview" class="block min-w-0 flex-1 truncate text-[11px]" />
        <span
          v-else
          class="block min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
          :class="preview === '' && 'italic'"
          >{{ preview || 'empty payload' }}</span
        >
        <span class="shrink-0 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
          {{ FORMAT_META[item.format].short }}
        </span>
        <QosBadge v-if="showQos" :qos="item.qos" :tooltip="false" />
      </span>
    </button>
    <div class="absolute top-1 right-1 flex items-center gap-0.5">
      <HintTooltip :label="connected ? 'Publish now' : 'Connect to publish'">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          tabindex="-1"
          data-testid="publish-saved-send"
          :aria-label="`Publish ${item.name} now`"
          :disabled="!connected"
          :class="[REVEAL, 'text-muted-foreground hover:text-foreground']"
          @click.stop="emit('send')"
        >
          <PlayIcon class="fill-current" aria-hidden="true" />
        </Button>
      </HintTooltip>
      <HintTooltip label="Remove" :keys="['Del']">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          tabindex="-1"
          :aria-label="`Remove ${item.name}`"
          :class="[REVEAL, 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive']"
          @click.stop="emit('remove')"
        >
          <XIcon aria-hidden="true" />
        </Button>
      </HintTooltip>
    </div>
  </div>
</template>
