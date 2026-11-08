<script setup lang="ts">
/**
 * Search field (`v-model` string) with a leading search icon, a clear button when filled and
 * an optional shortcut hint when empty. Escape clears a non-empty field (and does not bubble,
 * so an enclosing dialog stays open); on an empty field Escape propagates normally.
 * Attributes and listeners (`data-testid`, `aria-*`, `@keydown`…) go to the `<input>`; the
 * built-in Escape handling runs first (capture), so listeners can check `event.defaultPrevented`.
 */
import { nextTick, onMounted, ref, type HTMLAttributes } from 'vue'
import { SearchIcon, XIcon } from '@lucide/vue'
import { cn } from '@/lib/utils'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@/components/ui/input-group'
import KbdShortcut from './KbdShortcut.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    placeholder?: string
    /** Hint shown while empty, e.g. `['Mod', 'F']`. */
    shortcut?: readonly string[]
    size?: 'sm' | 'default'
    autofocus?: boolean
    class?: HTMLAttributes['class']
  }>(),
  { placeholder: 'Search…', size: 'default', autofocus: false }
)

const model = defineModel<string>({ default: '' })

const group = ref<{ $el?: unknown } | null>(null)

function input(): HTMLInputElement | null {
  const root = group.value?.$el
  return root instanceof HTMLElement ? root.querySelector('input') : null
}

function focus(): void {
  input()?.focus()
}

function select(): void {
  input()?.focus()
  input()?.select()
}

function clear(): void {
  model.value = ''
  focus()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !model.value) return
  event.preventDefault()
  event.stopPropagation()
  model.value = ''
}

onMounted(() => {
  if (props.autofocus) void nextTick(focus)
})

defineExpose({
  /** Focuses the input. */
  focus,
  /** Focuses the input and selects its text (e.g. for Mod+F). */
  select
})
</script>

<template>
  <InputGroup
    ref="group"
    data-slot="search-input"
    :class="cn(size === 'sm' ? 'h-7' : 'h-8', props.class)"
  >
    <InputGroupAddon :class="size === 'sm' ? 'pl-1.5' : undefined">
      <SearchIcon :class="size === 'sm' ? 'size-3.5' : 'size-4'" aria-hidden="true" />
    </InputGroupAddon>
    <InputGroupInput
      :model-value="model"
      type="search"
      :placeholder="placeholder"
      :aria-label="placeholder"
      autocomplete="off"
      spellcheck="false"
      :class="
        cn('h-full [&::-webkit-search-cancel-button]:hidden', size === 'sm' && 'text-xs md:text-xs')
      "
      v-bind="$attrs"
      @update:model-value="(value: string | number) => (model = String(value))"
      @keydown.capture="onKeydown"
    />
    <InputGroupAddon v-if="model" align="inline-end">
      <InputGroupButton size="icon-xs" aria-label="Clear search" title="Clear" @click="clear">
        <XIcon aria-hidden="true" />
      </InputGroupButton>
    </InputGroupAddon>
    <InputGroupAddon v-else-if="shortcut?.length" align="inline-end" class="pointer-events-none">
      <KbdShortcut :keys="shortcut" />
    </InputGroupAddon>
  </InputGroup>
</template>
