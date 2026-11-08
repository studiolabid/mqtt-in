<script setup lang="ts">
/**
 * One publish history entry: topic and age, payload preview, format, retain and QoS. The row
 * button loads the entry; on hover / keyboard focus a "…" menu (Copy as command ▸
 * mosquitto_pub / mqttx pub, FP-4) and the remove button appear.
 */
import { computed, ref, useId } from 'vue'
import { EllipsisIcon, PinIcon, TerminalIcon, XIcon } from '@lucide/vue'
import { HintTooltip, JsonInline, QosBadge, RelativeTime, TopicLabel } from '@/components/common'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useUiStore } from '@/stores'
import type { PublishHistoryItem } from '@/types'
import { useHistoryCommand } from '../composables/useHistoryCommand'
import { usePublishConnection } from '../composables/usePublishContext'
import { FORMAT_META, isJsonAuthored, previewText } from '../utils/payload-tools'

const props = defineProps<{
  item: PublishHistoryItem
  index: number
}>()

const emit = defineEmits<{ load: []; remove: [] }>()

const ui = useUiStore()
const connection = usePublishConnection()
const command = useHistoryCommand(() => connection?.() ?? ui.shownConnectionId)
const uid = useId()
const menuOpen = ref(false)

const preview = computed(() => previewText(props.item.payload))
const json = computed(() => isJsonAuthored(props.item.format) && preview.value !== '')
/** Built when the menu opens (rendering a template once). */
const commands = computed(() => (menuOpen.value ? command.itemsFor(props.item) : []))

const REVEAL =
  'opacity-0 transition-opacity group-hover/row:opacity-100 group-has-[[data-row]:focus-visible]/row:opacity-100'
</script>

<template>
  <div
    class="group/row relative rounded-md transition-colors hover:bg-accent/60 has-[[data-row]:focus-visible]:bg-accent"
  >
    <button
      type="button"
      data-row
      :data-index="index"
      class="flex w-full min-w-0 flex-col gap-1 rounded-md px-2 py-1.5 text-left outline-none"
      @click="emit('load')"
    >
      <span class="flex w-full min-w-0 items-center gap-2">
        <TopicLabel :topic="item.topic" class="flex-1 text-xs" />
        <RelativeTime
          :timestamp="item.timestamp"
          class="shrink-0 text-[11px] text-muted-foreground group-hover/row:invisible group-has-[[data-row]:focus-visible]/row:invisible"
        />
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
        <span v-if="item.retain" class="inline-flex shrink-0 text-primary-text" title="Retained">
          <PinIcon class="size-3" aria-hidden="true" />
          <span class="sr-only">Retained</span>
        </span>
        <QosBadge :qos="item.qos" :tooltip="false" />
      </span>
    </button>
    <div class="absolute top-1 right-1 flex items-center gap-0.5">
      <DropdownMenu v-model:open="menuOpen">
        <HintTooltip label="More actions">
          <DropdownMenuTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="More actions"
              :class="[
                REVEAL,
                'text-muted-foreground focus-visible:opacity-100',
                menuOpen && 'opacity-100'
              ]"
            >
              <EllipsisIcon aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </HintTooltip>
        <DropdownMenuContent align="end" class="w-52">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="copy-as-command">
              <TerminalIcon />
              Copy as command
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent class="w-64">
              <template v-for="entry in commands" :key="entry.tool">
                <DropdownMenuItem
                  :data-testid="entry.testId"
                  :disabled="!entry.result.ok"
                  :aria-describedby="entry.reason ? `${uid}-${entry.tool}` : undefined"
                  @select="command.copy(entry)"
                >
                  <span class="font-mono text-xs">{{ entry.label }}</span>
                </DropdownMenuItem>
                <p
                  v-if="entry.reason"
                  :id="`${uid}-${entry.tool}`"
                  class="px-1.5 pb-1.5 text-xs leading-snug text-muted-foreground"
                >
                  {{ entry.reason }}
                </p>
              </template>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
      <HintTooltip label="Remove from history" :keys="['Del']">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          tabindex="-1"
          aria-label="Remove from history"
          :class="[REVEAL, 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive']"
          @click.stop="emit('remove')"
        >
          <XIcon aria-hidden="true" />
        </Button>
      </HintTooltip>
    </div>
  </div>
</template>
