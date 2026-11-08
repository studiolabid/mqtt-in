<script setup lang="ts">
/**
 * Topic name input with suggestions (topics published before + recently active ones) and
 * inline validation (destructive ring + tooltip). ↑ / ↓ highlight a suggestion, Enter picks it
 * (or moves on to the payload), Escape closes the list, Mod+Enter publishes.
 */
import { computed, nextTick, ref, useId, watch } from 'vue'
import { ArrowDownLeftIcon, ArrowUpRightIcon, CircleAlertIcon } from '@lucide/vue'
import { TopicLabel } from '@/components/common'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTopicSuggestions } from '../composables/useTopicSuggestions'
import { isPublishShortcut } from '../utils/keys'

const props = defineProps<{
  connectionId: string
  /** Validation problem of the current value (`validateTopicName`), or null. */
  error: string | null
}>()

const model = defineModel<string>({ required: true })

const emit = defineEmits<{
  /** Mod+Enter. */
  submit: []
  /** Enter without a highlighted suggestion: continue with the payload. */
  next: []
}>()

const root = ref<HTMLElement | null>(null)
const focused = ref(false)
const hovered = ref(false)
/** The suggestion list stays closed until the user clicks, types or presses ↓. */
const dismissed = ref(true)
/** Also flag an empty topic while focused (after a publish attempt). */
const revealed = ref(false)
const active = ref(-1)
const listId = useId()

const { items, refresh } = useTopicSuggestions(() => props.connectionId, model)

const open = computed(() => focused.value && !dismissed.value && items.value.length > 0)
/** "Topic is required" waits until the field is left; other problems show right away. */
const shownError = computed(() => {
  if (!props.error) return null
  return model.value !== '' || !focused.value || revealed.value ? props.error : null
})
const errorTipOpen = computed(
  () => shownError.value !== null && (focused.value || hovered.value) && !open.value
)
const activeOption = computed(() =>
  open.value && active.value >= 0 ? optionId(active.value) : undefined
)

watch(items, (list) => {
  if (active.value >= list.length) active.value = list.length - 1
})

watch(active, (index) => {
  if (index < 0) return
  void nextTick(() =>
    document.getElementById(optionId(index))?.scrollIntoView({ block: 'nearest' })
  )
})

function optionId(index: number): string {
  return `${listId}-option-${index}`
}

function inputElement(): HTMLInputElement | null {
  return root.value?.querySelector('input') ?? null
}

function onFocus(): void {
  focused.value = true
  refresh()
}

function onBlur(): void {
  focused.value = false
  dismissed.value = true
  revealed.value = false
  active.value = -1
}

function onInput(): void {
  dismissed.value = false
  revealed.value = false
  active.value = -1
}

function onClick(): void {
  if (!dismissed.value) return
  refresh()
  dismissed.value = false
}

function pick(topic: string): void {
  model.value = topic
  dismissed.value = true
  active.value = -1
  void nextTick(() => inputElement()?.setSelectionRange(topic.length, topic.length))
}

function move(step: 1 | -1): void {
  const count = items.value.length
  if (count === 0) return
  if (!open.value || active.value < 0) {
    dismissed.value = false
    active.value = step === 1 ? 0 : count - 1
    return
  }
  active.value = (active.value + step + count) % count
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (isPublishShortcut(event)) {
    event.preventDefault()
    dismissed.value = true
    emit('submit')
    return
  }
  const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp':
      if (items.value.length === 0 && !open.value) return
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
      break
    case 'Enter':
      if (!plain) return
      event.preventDefault()
      if (open.value && active.value >= 0) pick(items.value[active.value].topic)
      else emit('next')
      break
    case 'Escape':
      if (!open.value) return
      event.preventDefault()
      event.stopPropagation()
      dismissed.value = true
      break
    case 'Tab':
      dismissed.value = true
      break
  }
}

function onOpenChange(value: boolean): void {
  if (!value) dismissed.value = true
}

/** Clicks into the input itself must not close the list. */
function onInteractOutside(event: Event): void {
  if (event.target instanceof Node && root.value?.contains(event.target)) event.preventDefault()
}

defineExpose({
  focus: (): void => inputElement()?.focus(),
  /** Focuses the input and shows its validation problem (also "Topic is required"). */
  revealError: (): void => {
    revealed.value = true
    inputElement()?.focus()
  }
})
</script>

<template>
  <Popover :open="open" @update:open="onOpenChange">
    <PopoverAnchor as-child>
      <div
        ref="root"
        class="relative min-w-0 flex-1"
        @pointerenter="hovered = true"
        @pointerleave="hovered = false"
      >
        <Tooltip :open="errorTipOpen">
          <TooltipTrigger as-child>
            <Input
              v-model="model"
              data-testid="publish-topic"
              role="combobox"
              aria-label="Topic"
              aria-autocomplete="list"
              :aria-expanded="open"
              :aria-controls="open ? listId : undefined"
              :aria-activedescendant="activeOption"
              :aria-invalid="shownError ? true : undefined"
              placeholder="Topic"
              autocomplete="off"
              spellcheck="false"
              class="h-7 rounded-[min(var(--radius-md),10px)] px-2 font-mono text-xs md:text-xs"
              @focus="onFocus"
              @blur="onBlur"
              @input="onInput"
              @click="onClick"
              @keydown="onKeydown"
            />
          </TooltipTrigger>
          <TooltipContent side="top" :side-offset="6" class="max-w-80">
            <CircleAlertIcon class="size-3.5 shrink-0" aria-hidden="true" />
            <span>{{ shownError }}</span>
          </TooltipContent>
        </Tooltip>
      </div>
    </PopoverAnchor>
    <PopoverContent
      side="bottom"
      align="start"
      :side-offset="4"
      class="w-(--reka-popover-trigger-width) max-w-[min(36rem,var(--reka-popover-content-available-width))] min-w-72 gap-0 p-1"
      @open-auto-focus.prevent
      @close-auto-focus.prevent
      @interact-outside="onInteractOutside"
    >
      <p
        class="flex items-center justify-between px-2 pt-1 pb-1.5 text-[11px] text-muted-foreground"
      >
        <span class="font-medium">Topics</span>
        <span class="flex items-center gap-2.5">
          <span class="flex items-center gap-1">
            <ArrowUpRightIcon class="size-3 text-outgoing" aria-hidden="true" />published
          </span>
          <span class="flex items-center gap-1">
            <ArrowDownLeftIcon class="size-3 text-incoming" aria-hidden="true" />seen
          </span>
        </span>
      </p>
      <div
        :id="listId"
        role="listbox"
        aria-label="Topic suggestions"
        class="scrollbar-slim max-h-64 overflow-y-auto"
      >
        <div
          v-for="(item, index) in items"
          :id="optionId(index)"
          :key="item.topic"
          role="option"
          :aria-selected="index === active"
          class="flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-xs transition-colors"
          :class="index === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'"
          @mousedown.prevent
          @mousemove="active = index"
          @click="pick(item.topic)"
        >
          <ArrowUpRightIcon
            v-if="item.published"
            class="size-3.5 shrink-0 text-outgoing"
            aria-hidden="true"
          />
          <ArrowDownLeftIcon v-else class="size-3.5 shrink-0 text-incoming" aria-hidden="true" />
          <TopicLabel :topic="item.topic" :highlight="model" class="flex-1" />
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
