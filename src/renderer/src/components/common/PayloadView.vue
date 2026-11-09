<script setup lang="ts">
/**
 * Read-only payload viewer: decodes bytes with `decodePayload` (pretty, first 1 MiB) and shows
 * them in a read-only CodeEditor (JSON highlighting when the result is JSON). Decode problems
 * and truncation are reported inline; the text stays selectable and searchable (Ctrl+F).
 */
import { computed, type HTMLAttributes } from 'vue'
import { TriangleAlertIcon } from '@lucide/vue'
import type { ViewFormat } from '@shared/models'
import { decodePayload } from '@shared/payload'
import { cn } from '@/lib/utils'
import { formatBytes } from '@/utils/format'
// The async editor: CodeMirror loads with the first payload shown, not at startup.
import { CodeEditor } from './async'

/** Payloads larger than this are cut for display. */
const MAX_BYTES = 1024 * 1024

const props = withDefaults(
  defineProps<{
    payload: Uint8Array
    format: ViewFormat
    wrap?: boolean
    /** CSS length; scrolls beyond it. */
    maxHeight?: string
    /** `auto` = only for multi-line output. */
    lineNumbers?: boolean | 'auto'
    /** Briefly mark the lines a payload change altered (see `CodeEditor`). */
    flashChanges?: boolean
    class?: HTMLAttributes['class']
  }>(),
  { wrap: true, lineNumbers: 'auto', flashChanges: false }
)

const decoded = computed(() =>
  decodePayload(props.payload, props.format, { pretty: true, maxBytes: MAX_BYTES })
)

const showLineNumbers = computed(() =>
  props.lineNumbers === 'auto' ? decoded.value.text.includes('\n') : props.lineNumbers
)
</script>

<template>
  <div
    data-slot="payload-view"
    :class="
      cn(
        'flex min-w-0 flex-col overflow-hidden rounded-lg border border-input bg-transparent transition-[color,box-shadow] dark:bg-input/30',
        'has-[.cm-focused]:border-ring has-[.cm-focused]:ring-3 has-[.cm-focused]:ring-ring/50',
        props.class
      )
    "
  >
    <p v-if="payload.length === 0" class="px-3 py-2.5 text-xs text-muted-foreground italic">
      Empty payload
    </p>
    <template v-else>
      <p
        v-if="decoded.error"
        class="flex items-start gap-1.5 border-b bg-warning/5 px-3 py-1.5 text-xs text-warning"
      >
        <TriangleAlertIcon class="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span class="min-w-0 wrap-break-word">{{ decoded.error }}</span>
      </p>
      <CodeEditor
        :model-value="decoded.text"
        readonly
        :language="decoded.json ? 'json' : 'text'"
        :wrap="wrap"
        :line-numbers="showLineNumbers"
        :flash-changes="flashChanges"
        min-height="0px"
        :max-height="maxHeight"
        label="Payload"
        class="select-text"
      />
      <p
        v-if="decoded.truncated"
        class="border-t px-3 py-1.5 text-xs text-muted-foreground tabular-nums"
      >
        Showing first {{ formatBytes(MAX_BYTES) }} of {{ formatBytes(payload.length) }}
      </p>
    </template>
  </div>
</template>
