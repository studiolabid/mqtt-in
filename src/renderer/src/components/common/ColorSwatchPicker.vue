<script setup lang="ts">
/**
 * Color picker for connection / subscription tags: a keyboard-accessible swatch radio group
 * (arrow keys, Home / End, roving tab stop) plus an optional custom color (native picker and
 * hex field). `v-model` is a hex string; palette entries are compared case-insensitively.
 */
import { computed, nextTick, ref, watch, type HTMLAttributes } from 'vue'
import { PlusIcon } from '@lucide/vue'
import { PALETTE } from '@shared/defaults'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { colorName, normalizeHex } from './lib/color'

const props = withDefaults(
  defineProps<{
    colors?: readonly string[]
    allowCustom?: boolean
    disabled?: boolean
    /** Accessible name of the swatch group. */
    label?: string
    class?: HTMLAttributes['class']
  }>(),
  { colors: () => PALETTE, allowCustom: true, disabled: false, label: 'Color' }
)

const model = defineModel<string>({ default: '' })

const group = ref<HTMLElement | null>(null)
const current = computed(() => normalizeHex(model.value ?? ''))
const selectedIndex = computed(() =>
  current.value === null ? -1 : props.colors.findIndex((c) => normalizeHex(c) === current.value)
)
const isCustom = computed(() => current.value !== null && selectedIndex.value === -1)
/** The swatch that owns the group's tab stop. */
const tabStop = computed(() => Math.max(0, selectedIndex.value))

function select(index: number): void {
  const color = props.colors[index]
  if (color !== undefined && !props.disabled) model.value = color
}

const NAV: Readonly<Record<string, (index: number, count: number) => number>> = {
  ArrowRight: (i, n) => (i + 1) % n,
  ArrowDown: (i, n) => (i + 1) % n,
  ArrowLeft: (i, n) => (i - 1 + n) % n,
  ArrowUp: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_, n) => n - 1
}

function onKeydown(event: KeyboardEvent, index: number): void {
  const move = NAV[event.key]
  const count = props.colors.length
  if (!move || count === 0) return
  event.preventDefault()
  const next = move(index, count)
  select(next)
  void nextTick(() =>
    group.value?.querySelector<HTMLButtonElement>(`[data-swatch="${next}"]`)?.focus()
  )
}

// Hex field: edited freely, committed whenever it holds a valid color.
const hexDraft = ref(current.value ?? '')
watch(current, (value) => {
  if (value !== null && normalizeHex(hexDraft.value) !== value) hexDraft.value = value
})

function onHexInput(value: string | number): void {
  hexDraft.value = String(value)
  const hex = normalizeHex(hexDraft.value)
  if (hex !== null && hex !== current.value) model.value = hex
}

function commitHex(): void {
  hexDraft.value = current.value ?? ''
}

function onPick(event: Event): void {
  const target = event.target
  if (target instanceof HTMLInputElement) model.value = target.value
}
</script>

<template>
  <div
    data-slot="color-swatch-picker"
    :class="cn('flex flex-wrap items-center gap-2', props.class)"
  >
    <div
      ref="group"
      role="radiogroup"
      :aria-label="label"
      :aria-disabled="disabled || undefined"
      class="flex flex-wrap items-center gap-1.5"
    >
      <button
        v-for="(color, index) in colors"
        :key="`${index}:${color}`"
        type="button"
        role="radio"
        :data-swatch="index"
        :aria-checked="index === selectedIndex"
        :aria-label="colorName(color)"
        :title="colorName(color)"
        :tabindex="index === tabStop ? 0 : -1"
        :disabled="disabled"
        :style="{ '--swatch': color }"
        class="size-6 rounded-md bg-(--swatch) shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_12%,transparent)] ring-offset-2 ring-offset-background transition-transform duration-150 outline-none hover:scale-110 focus-visible:scale-110 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-checked:ring-2 aria-checked:ring-(--swatch)"
        @click="select(index)"
        @keydown="onKeydown($event, index)"
      />
    </div>
    <template v-if="allowCustom">
      <label
        title="Custom color"
        :style="isCustom ? { '--swatch': current ?? undefined } : undefined"
        :class="
          cn(
            'relative inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-transform duration-150 hover:scale-110 hover:text-foreground has-focus-visible:scale-110 has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-background',
            isCustom
              ? 'bg-(--swatch) ring-2 ring-(--swatch) ring-offset-2 ring-offset-background'
              : 'border border-dashed border-muted-foreground/40',
            disabled && 'pointer-events-none opacity-50'
          )
        "
      >
        <input
          type="color"
          class="sr-only"
          aria-label="Custom color"
          :value="current ?? '#000000'"
          :disabled="disabled"
          @input="onPick"
        />
        <PlusIcon v-if="!isCustom" class="size-3.5" aria-hidden="true" />
      </label>
      <Input
        :model-value="hexDraft"
        aria-label="Hex color"
        placeholder="#rrggbb"
        maxlength="7"
        autocomplete="off"
        spellcheck="false"
        :disabled="disabled"
        class="h-7 w-[5.75rem] px-2 font-mono text-xs uppercase md:text-xs"
        @update:model-value="onHexInput"
        @blur="commitHex"
        @keydown.enter="commitHex"
      />
    </template>
  </div>
</template>
