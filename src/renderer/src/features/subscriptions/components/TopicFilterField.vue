<script setup lang="ts">
/**
 * Topic filter field of the subscription dialog: a mono input (or, in "Add multiple" mode, a
 * textarea with one filter per line) with wildcard chips, examples, live validation and a
 * preview of how many known topics the filter matches.
 */
import { computed, nextTick, ref } from 'vue'
import { ScanSearchIcon } from '@lucide/vue'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupTextarea
} from '@/components/ui/input-group'
import { Switch } from '@/components/ui/switch'
import { useFormatters } from '@/composables'
import { formatCount } from '@/utils/format'
import type { FilterPreview } from '../composables/useFilterPreview'
import {
  appendLine,
  insertWildcard,
  lineRange,
  type ParsedFilterLines,
  type TextEdit,
  type WildcardToken
} from '../utils/filter-lines'
import FilterTools from './FilterTools.vue'

const props = defineProps<{
  /** Offer the "Add multiple" switch (create mode). */
  allowMultiple: boolean
  error: string | null
  preview: FilterPreview | null
  /** Parsed lines in "Add multiple" mode. */
  parsed: ParsedFilterLines | null
}>()

const topic = defineModel<string>('topic', { required: true })
const lines = defineModel<string>('lines', { required: true })
const multiple = defineModel<boolean>('multiple', { required: true })

const INPUT_ID = 'subscription-topic-input'
const HINT_ID = 'subscription-topic-hint'
const MULTI_PLACEHOLDER = 'sensors/#\nalerts/+/critical\n$SYS/broker/load/#'

const fmt = useFormatters()
const input = ref<{ $el?: unknown } | null>(null)
const textarea = ref<{ $el?: unknown } | null>(null)

const matched = computed(() => fmt.number(props.preview?.topics ?? 0))
const known = computed(() => fmt.number(props.preview?.known ?? 0))
/** First matching topics, with an ellipsis when there are more. */
const samples = computed(() => {
  const preview = props.preview
  if (!preview || preview.samples.length === 0) return ''
  const more = preview.topics > preview.samples.length ? ', …' : ''
  return preview.samples.join(', ') + more
})

const summary = computed(() => {
  const result = props.parsed
  if (!result) return ''
  const parts: string[] = []
  if (result.filters.length > 0) parts.push(formatCount(result.filters.length, 'filter'))
  if (result.existing.length > 0) parts.push(`${result.existing.length} existing`)
  return parts.join(' · ')
})

function control(): HTMLInputElement | HTMLTextAreaElement | null {
  const el = (multiple.value ? textarea.value : input.value)?.$el
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null
}

async function apply(edit: TextEdit): Promise<void> {
  if (multiple.value) lines.value = edit.value
  else topic.value = edit.value
  await nextTick()
  const el = control()
  el?.focus()
  el?.setSelectionRange(edit.caret, edit.caret)
}

function insert(token: WildcardToken): void {
  const value = multiple.value ? lines.value : topic.value
  const el = control()
  const start = el?.selectionStart ?? value.length
  const end = el?.selectionEnd ?? start
  void apply(insertWildcard(value, start, end, token))
}

function useExample(filter: string): void {
  void apply(
    multiple.value ? appendLine(lines.value, filter) : { value: filter, caret: filter.length }
  )
}

/** Focuses the input with the caret at the end. */
function focus(): void {
  const el = control()
  if (!el) return
  el.focus()
  el.setSelectionRange(el.value.length, el.value.length)
}

/** Focuses the textarea and selects a 1-based line (an invalid filter). */
function selectLine(line: number): void {
  const el = control()
  if (!el) return
  const [start, end] = lineRange(el.value, line)
  el.focus()
  el.setSelectionRange(start, end)
}

defineExpose({ focus, selectLine })
</script>

<template>
  <Field :data-invalid="error ? true : undefined">
    <div class="flex min-h-5 items-center justify-between gap-3">
      <FieldLabel :for="INPUT_ID">{{ multiple ? 'Topic filters' : 'Topic filter' }}</FieldLabel>
      <label
        v-if="allowMultiple"
        class="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        Add multiple
        <Switch v-model="multiple" size="sm" data-testid="subscription-multiple" />
      </label>
    </div>

    <InputGroup v-if="!multiple">
      <InputGroupInput
        :id="INPUT_ID"
        ref="input"
        v-model="topic"
        data-testid="subscription-topic"
        placeholder="sensors/+/temperature"
        autocomplete="off"
        spellcheck="false"
        :aria-invalid="error ? true : undefined"
        :aria-describedby="HINT_ID"
        class="font-mono text-[13px] md:text-[13px]"
      />
      <InputGroupAddon align="inline-end" class="gap-0.5">
        <FilterTools @insert="insert" @example="useExample" @done="focus" />
      </InputGroupAddon>
    </InputGroup>
    <InputGroup v-else>
      <InputGroupTextarea
        :id="INPUT_ID"
        ref="textarea"
        v-model="lines"
        data-testid="subscription-topic"
        rows="4"
        autocomplete="off"
        spellcheck="false"
        :placeholder="MULTI_PLACEHOLDER"
        :aria-invalid="error ? true : undefined"
        :aria-describedby="HINT_ID"
        class="max-h-52 min-h-24 font-mono text-[13px] leading-relaxed md:text-[13px]"
      />
      <InputGroupAddon align="block-end" class="gap-0.5 border-t py-1.5 [.border-t]:pt-1.5">
        <FilterTools @insert="insert" @example="useExample" @done="focus" />
        <span class="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
          {{ summary }}
        </span>
      </InputGroupAddon>
    </InputGroup>

    <FieldError v-if="error" :id="HINT_ID" class="text-xs">{{ error }}</FieldError>
    <p
      v-else-if="!multiple && preview"
      :id="HINT_ID"
      class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      <ScanSearchIcon class="size-3.5 shrink-0" aria-hidden="true" />
      <span v-if="preview.topics > 0" class="shrink-0">
        Matches <span class="font-medium text-foreground tabular-nums">{{ matched }}</span> of
        {{ known }} known topics
      </span>
      <span v-else class="shrink-0">No known topic matches yet</span>
      <span
        v-if="samples"
        class="min-w-0 truncate font-mono text-[11px] select-text"
        :title="preview.samples.join('\n')"
      >
        · {{ samples }}
      </span>
    </p>
    <FieldDescription v-else-if="multiple" :id="HINT_ID" class="text-xs">
      One filter per line. Filters that already exist are skipped.
    </FieldDescription>
    <FieldDescription v-else :id="HINT_ID" class="text-xs">
      <code class="font-mono text-foreground">+</code> matches one level,
      <code class="font-mono text-foreground">#</code> all remaining levels.
    </FieldDescription>
  </Field>
</template>
