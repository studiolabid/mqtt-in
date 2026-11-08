<script setup lang="ts">
/**
 * Status bar under the payload editor: live validation (encoded size or the problem, an
 * offer to convert after a format switch) on the left; JSON format / minify, the template
 * toggle and variables, load from file and clear on the right.
 *
 * The template toggle's "on" state is framed (an inset ring), not just the hover gray, so it
 * reads in the Mono look (UX-08); accent-colored text uses `text-primary-text` (A11Y-06).
 */
import { computed } from 'vue'
import {
  ArrowRightLeftIcon,
  BracesIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  EraserIcon,
  FileUpIcon
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { PayloadFormat } from '@shared/models'
import { HintTooltip } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Toggle } from '@/components/ui/toggle'
import { usePublishStore } from '@/stores'
import { formatBytes, formatNumber } from '@/utils/format'
import { usePayloadFile } from '../composables/usePayloadFile'
import { usePayloadStatus } from '../composables/usePayloadStatus'
import { FORMAT_META, isJsonAuthored, reformatJson } from '../utils/payload-tools'
import VariablesPopover from './VariablesPopover.vue'

const props = defineProps<{
  connectionId: string
  /** Format the payload was written in before the last switch, when converting is possible. */
  convertFrom: PayloadFormat | null
}>()

const emit = defineEmits<{
  insert: [token: string]
  convert: []
  /** The payload was replaced from here (cleared / loaded): continue in the editor. */
  edited: []
}>()

const publish = usePublishStore()
const draft = computed(() => publish.draft(props.connectionId))
const status = usePayloadStatus(() => draft.value)
const { loading: fileLoading, load: loadPayloadFile } = usePayloadFile(() => props.connectionId)

const jsonLike = computed(() => isJsonAuthored(draft.value.format))
const empty = computed(() => draft.value.payload.length === 0)

const templateHint = computed(() =>
  draft.value.useTemplate
    ? 'Templates on: {{variables}} are rendered when sending'
    : 'Templates off: the payload is sent exactly as written'
)

function reformat(mode: 'pretty' | 'minify'): void {
  try {
    const next = reformatJson(draft.value.payload, mode)
    if (next !== draft.value.payload) draft.value.payload = next
  } catch (err) {
    toast.error(mode === 'pretty' ? 'Cannot format the payload' : 'Cannot minify the payload', {
      description: err instanceof Error ? err.message : String(err)
    })
  }
}

function clear(): void {
  draft.value.payload = ''
  emit('edited')
}

async function loadFile(): Promise<void> {
  if (await loadPayloadFile()) emit('edited')
}
</script>

<template>
  <div
    class="@container/footer flex h-8 min-w-0 items-center gap-2 overflow-hidden rounded-b-lg border-t bg-muted/40 pr-1 pl-2.5 text-xs dark:bg-muted/25"
  >
    <!-- Validation -->
    <div class="flex min-w-0 flex-1 items-center gap-1.5">
      <template v-if="status.kind === 'error'">
        <CircleAlertIcon class="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
        <span class="min-w-0 truncate text-destructive" :title="status.message">
          {{ status.sample ? `Rendered sample: ${status.message}` : status.message }}
        </span>
      </template>
      <template v-else-if="status.bytes === 0">
        <CircleDashedIcon class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span class="min-w-0 truncate text-muted-foreground">
          {{
            draft.retain
              ? 'Empty retained payload: clears the topic’s retained message'
              : 'Empty payload'
          }}
        </span>
      </template>
      <template v-else>
        <CheckIcon class="size-3.5 shrink-0 text-success" aria-hidden="true" />
        <span
          class="shrink-0 font-mono text-foreground/80 tabular-nums"
          :title="`${formatNumber(status.bytes)} bytes${status.sample ? ' (rendered sample)' : ''}`"
          >{{ status.sample ? '≈ ' : '' }}{{ formatBytes(status.bytes) }}</span
        >
        <span v-if="status.sample" class="hidden truncate text-muted-foreground @md/footer:inline">
          · rendered sample
        </span>
      </template>
      <Button
        v-if="convertFrom"
        variant="ghost"
        size="xs"
        class="h-6 shrink-0 gap-1 px-1.5 text-primary-text hover:text-primary-text"
        @click="emit('convert')"
      >
        <ArrowRightLeftIcon aria-hidden="true" />
        Convert from {{ FORMAT_META[convertFrom].short }}
      </Button>
    </div>

    <!-- Tools -->
    <div class="flex shrink-0 items-center gap-0.5">
      <template v-if="jsonLike">
        <HintTooltip label="Pretty print (template tokens are kept)">
          <Button
            variant="ghost"
            size="xs"
            class="h-6 px-1.5 text-muted-foreground"
            :disabled="empty"
            @click="reformat('pretty')"
          >
            Format
          </Button>
        </HintTooltip>
        <HintTooltip label="Remove all whitespace">
          <Button
            variant="ghost"
            size="xs"
            class="h-6 px-1.5 text-muted-foreground"
            :disabled="empty"
            @click="reformat('minify')"
          >
            Minify
          </Button>
        </HintTooltip>
        <span class="mx-1 h-4 w-px bg-border" aria-hidden="true" />
      </template>

      <HintTooltip :label="templateHint">
        <Toggle
          v-model="draft.useTemplate"
          size="sm"
          aria-label="Render template variables"
          class="h-6 min-w-6 gap-1 rounded-[min(var(--radius-md),10px)] px-1.5 text-xs text-muted-foreground aria-pressed:bg-primary/10 aria-pressed:text-primary-text aria-pressed:inset-ring-1 aria-pressed:inset-ring-primary/60 [&_svg:not([class*=size-])]:size-3.5"
        >
          <BracesIcon aria-hidden="true" />
          <span class="hidden @lg/footer:inline">Template</span>
        </Toggle>
      </HintTooltip>
      <VariablesPopover @insert="(token) => emit('insert', token)" />

      <span class="mx-1 h-4 w-px bg-border" aria-hidden="true" />

      <HintTooltip label="Load payload from a file…">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Load payload from a file"
          class="text-muted-foreground"
          :disabled="fileLoading"
          @click="loadFile"
        >
          <Spinner v-if="fileLoading" class="size-3" />
          <FileUpIcon v-else aria-hidden="true" />
        </Button>
      </HintTooltip>
      <HintTooltip label="Clear payload">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Clear payload"
          class="text-muted-foreground"
          :disabled="empty"
          @click="clear"
        >
          <EraserIcon aria-hidden="true" />
        </Button>
      </HintTooltip>
    </div>
  </div>
</template>
