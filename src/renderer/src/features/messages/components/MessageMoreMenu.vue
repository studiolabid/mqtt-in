<script setup lang="ts">
/**
 * "More" menu of the message toolbar: every secondary control (also those hidden from the
 * toolbar at narrow widths), filter reset and a shortcut to the message settings.
 */
import { computed } from 'vue'
import { ListEndIcon, BracesIcon, EllipsisIcon, RotateCcwIcon, SettingsIcon } from '@lucide/vue'
import { VIEW_FORMATS } from '@shared/payload'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNavigation } from '@/composables'
import { useUiStore } from '@/stores'
import type { DirectionFilter } from '@/types'
import { formatNumber } from '@/utils/format'
import { useAutoScroll } from '../composables/useAutoScroll'
import { isViewFormat, viewFormatLabel } from '../utils/message-meta'

const props = defineProps<{
  connectionId: string
  filterActive: boolean
  matched: number
  total: number
}>()

const ui = useUiStore()
const { openSettings } = useNavigation()
const autoScroll = useAutoScroll(() => props.connectionId)

const filter = computed(() => ui.messageFilter(props.connectionId))
const format = computed(() => ui.viewFormat(props.connectionId))

const DIRECTIONS: { value: DirectionFilter; label: string }[] = [
  { value: 'all', label: 'All messages' },
  { value: 'in', label: 'Incoming only' },
  { value: 'out', label: 'Outgoing only' }
]

function setDirection(value: unknown): void {
  const match = DIRECTIONS.find((item) => item.value === value)
  if (match) ui.updateMessageFilter(props.connectionId, { direction: match.value })
}

function setFormat(value: unknown): void {
  if (isViewFormat(value)) ui.setViewFormat(props.connectionId, value)
}
</script>

<template>
  <DropdownMenu>
    <Tooltip>
      <TooltipTrigger as-child>
        <DropdownMenuTrigger as-child>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="More message options"
            class="text-muted-foreground hover:text-foreground"
          >
            <EllipsisIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent>More options</TooltipContent>
    </Tooltip>
    <DropdownMenuContent align="end" class="w-64">
      <DropdownMenuLabel class="flex items-center justify-between gap-3">
        Messages
        <span class="font-mono tabular-nums">
          <template v-if="filterActive">{{ formatNumber(matched) }} / </template
          >{{ formatNumber(total) }}
        </span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuRadioGroup :model-value="filter.direction" @update:model-value="setDirection">
        <DropdownMenuRadioItem v-for="item in DIRECTIONS" :key="item.value" :value="item.value">
          {{ item.label }}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuCheckboxItem
        :model-value="filter.retainedOnly"
        @update:model-value="
          (value) => ui.updateMessageFilter(connectionId, { retainedOnly: value === true })
        "
      >
        Retained only
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <BracesIcon />
          View payloads as
          <span class="ml-auto pl-2 text-xs text-muted-foreground">{{
            viewFormatLabel(format)
          }}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent class="w-44">
          <DropdownMenuRadioGroup :model-value="format" @update:model-value="setFormat">
            <DropdownMenuRadioItem
              v-for="item in VIEW_FORMATS"
              :key="item.value"
              :value="item.value"
            >
              {{ item.label }}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuCheckboxItem
        :model-value="autoScroll.enabled.value"
        @update:model-value="(value) => autoScroll.set(value === true)"
      >
        <ListEndIcon />
        Auto-scroll to new messages
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem :disabled="!filterActive" @select="ui.resetMessageFilter(connectionId)">
        <RotateCcwIcon />
        Reset filters
      </DropdownMenuItem>
      <DropdownMenuItem @select="openSettings('messages')">
        <SettingsIcon />
        Message settings…
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
