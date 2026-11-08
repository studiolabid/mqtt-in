<script setup lang="ts">
/**
 * Export dropdown: the filtered rows (when a filter is active) or every message in memory,
 * as JSON or CSV, through the native save dialog.
 */
import { DownloadIcon, FileJsonIcon, FileSpreadsheetIcon } from '@lucide/vue'
import type { MqttMessage } from '@shared/models'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMessagesStore } from '@/stores'
import { formatNumber } from '@/utils/format'
import { useMessageExport, type ExportKind } from '../composables/useMessageExport'

const props = defineProps<{
  connectionId: string
  /** The rows the list shows (read when an export starts). */
  getRows: () => readonly MqttMessage[]
  filterActive: boolean
  matched: number
  total: number
}>()

const messages = useMessagesStore()
const { busy, exportMessages } = useMessageExport(() => props.connectionId)

function run(kind: ExportKind, scope: 'filtered' | 'all'): void {
  const source = scope === 'filtered' ? props.getRows() : messages.messages(props.connectionId)
  void exportMessages(kind, source)
}
</script>

<template>
  <DropdownMenu>
    <Tooltip>
      <TooltipTrigger as-child>
        <DropdownMenuTrigger as-child>
          <Button
            data-testid="messages-export"
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Export messages"
            :disabled="busy || total === 0"
            class="text-muted-foreground hover:text-foreground"
          >
            <Spinner v-if="busy" />
            <DownloadIcon v-else aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent>Export messages</TooltipContent>
    </Tooltip>
    <DropdownMenuContent data-testid="messages-export-menu" align="end" class="w-56">
      <template v-if="filterActive">
        <DropdownMenuLabel class="flex items-center justify-between gap-3">
          Filtered messages
          <span class="font-mono tabular-nums">{{ formatNumber(matched) }}</span>
        </DropdownMenuLabel>
        <DropdownMenuItem :disabled="matched === 0" @select="run('json', 'filtered')">
          <FileJsonIcon />
          Export as JSON
        </DropdownMenuItem>
        <DropdownMenuItem :disabled="matched === 0" @select="run('csv', 'filtered')">
          <FileSpreadsheetIcon />
          Export as CSV
        </DropdownMenuItem>
        <DropdownMenuSeparator />
      </template>
      <DropdownMenuLabel class="flex items-center justify-between gap-3">
        All messages
        <span class="font-mono tabular-nums">{{ formatNumber(total) }}</span>
      </DropdownMenuLabel>
      <DropdownMenuItem @select="run('json', 'all')">
        <FileJsonIcon />
        Export as JSON
      </DropdownMenuItem>
      <DropdownMenuItem @select="run('csv', 'all')">
        <FileSpreadsheetIcon />
        Export as CSV
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
