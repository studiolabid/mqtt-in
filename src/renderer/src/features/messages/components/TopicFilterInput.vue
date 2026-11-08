<script setup lang="ts">
/**
 * Topic filter field (debounced into `ui.messageFilter(id).topic`). A valid `+` / `#` filter
 * matches with MQTT semantics (icon turns accent), anything else matches as a case-insensitive
 * substring; an invalid wildcard filter is flagged (it falls back to substring matching).
 * The field widens while focused and while it holds a filter, so the filter stays readable
 * (UX-10); it still shrinks first when the toolbar runs out of room.
 */
import { computed, ref } from 'vue'
import { ListFilterIcon, XIcon } from '@lucide/vue'
import { hasWildcard, validateTopicFilter } from '@shared/topic'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@/components/ui/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores'
import { useDebouncedModel } from '../composables/useDebouncedModel'

const props = defineProps<{ connectionId: string }>()

const ui = useUiStore()
const root = ref<HTMLElement | null>(null)

const { model } = useDebouncedModel(
  () => ui.messageFilter(props.connectionId).topic,
  (topic) => ui.updateMessageFilter(props.connectionId, { topic })
)

const state = computed(() => {
  const value = model.value.trim()
  if (!value) return { kind: 'empty' as const, error: null }
  if (!hasWildcard(value)) return { kind: 'text' as const, error: null }
  const error = validateTopicFilter(value)
  return error ? { kind: 'invalid' as const, error } : { kind: 'wildcard' as const, error: null }
})

const hint = computed(() => {
  switch (state.value.kind) {
    case 'wildcard':
      return 'MQTT filter: + matches one level, # matches all remaining levels'
    case 'invalid':
      return `${state.value.error}. Matching as plain text.`
    default:
      return 'Matches text anywhere in the topic. + and # work as MQTT wildcards.'
  }
})

function focusInput(): void {
  root.value?.querySelector('input')?.focus()
}

function clear(): void {
  model.value = ''
  focusInput()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !model.value) return
  event.preventDefault()
  event.stopPropagation()
  model.value = ''
}
</script>

<template>
  <div ref="root" class="contents">
    <InputGroup
      class="h-7 w-32 min-w-20 shrink focus-within:w-72 has-[input:not(:placeholder-shown)]:not-focus-within:w-56 motion-safe:transition-[width] motion-safe:duration-150 @3xl/toolbar:w-40 @5xl/toolbar:w-56"
    >
      <InputGroupAddon class="pl-2">
        <Tooltip>
          <TooltipTrigger as-child>
            <span class="inline-flex">
              <ListFilterIcon
                :class="
                  cn(
                    'size-3.5 transition-colors',
                    state.kind === 'wildcard' && 'text-primary-text',
                    state.kind === 'invalid' && 'text-warning'
                  )
                "
                aria-hidden="true"
              />
            </span>
          </TooltipTrigger>
          <TooltipContent class="max-w-64">{{ hint }}</TooltipContent>
        </Tooltip>
      </InputGroupAddon>
      <InputGroupInput
        data-testid="message-topic-filter"
        :model-value="model"
        type="text"
        placeholder="Filter topic, e.g. sensors/+/temp"
        aria-label="Filter by topic"
        :title="model || undefined"
        autocomplete="off"
        spellcheck="false"
        class="h-full font-mono text-xs md:text-xs"
        @update:model-value="(value: string | number) => (model = String(value))"
        @keydown="onKeydown"
      />
      <InputGroupAddon v-if="model" align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label="Clear topic filter"
          title="Clear"
          @click="clear"
        >
          <XIcon aria-hidden="true" />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </div>
</template>
