<script setup lang="ts">
/**
 * Numeric text input bound to `number | undefined`: empty → `undefined`, unparsable → `NaN`
 * (validation reports it). Unlike reka's NumberField the value is committed on every keystroke,
 * so Mod+Enter right after typing saves what is shown. `scale` edits a stored unit in another
 * one (milliseconds shown as seconds with `scale: 1000`); ArrowUp / ArrowDown step by 1
 * (Shift: 10). Attributes go to the <input>.
 */
import { ref, useAttrs, watch, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText
} from '@/components/ui/input-group'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    /** Unit shown after the value, e.g. `s`. */
    unit?: string
    /** Stored value = displayed value × scale. */
    scale?: number
    /** Accept decimals in the displayed value (useful with a scale). */
    decimals?: boolean
    /** Stepping bounds in stored units (typing is free: validation reports the range). */
    min?: number
    max?: number
    /** Borderless input for use inside an `InputGroup`. */
    bare?: boolean
    class?: HTMLAttributes['class']
  }>(),
  { scale: 1, decimals: false, min: 0, bare: false }
)

const model = defineModel<number | undefined>()
const attrs = useAttrs()

const INTEGER = /^\d+$/
const DECIMAL = /^\d+(?:[.,]\d+)?$/

function format(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return ''
  return String(Number((value / props.scale).toFixed(3)))
}

function parse(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  if (!(props.decimals ? DECIMAL : INTEGER).test(trimmed)) return Number.NaN
  return Math.round(Number(trimmed.replace(',', '.')) * props.scale)
}

const text = ref(format(model.value))

// External changes (protocol switch, pasted URL…) rewrite the text; the user's own spelling
// of the same value ("010", "1.50", or invalid text ↔ NaN) is kept.
watch(model, (value) => {
  if (!Object.is(parse(text.value), value)) text.value = format(value)
})

function onInput(value: string | number): void {
  text.value = String(value)
  model.value = parse(text.value)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const current = parse(text.value)
  if (current !== undefined && !Number.isFinite(current)) return
  event.preventDefault()
  const delta = (event.shiftKey ? 10 : 1) * props.scale * (event.key === 'ArrowUp' ? 1 : -1)
  let next = current === undefined ? props.min : current + delta
  if (props.max !== undefined) next = Math.min(props.max, next)
  next = Math.max(props.min, next)
  model.value = next
  text.value = format(next)
}

/** Called on every render: `attrs` is not reactive (e.g. a changing aria-invalid). */
function inputProps(): Record<string, unknown> {
  return {
    ...attrs,
    modelValue: text.value,
    inputmode: props.decimals ? 'decimal' : 'numeric',
    autocomplete: 'off',
    spellcheck: 'false',
    'onUpdate:modelValue': onInput,
    onKeydown
  }
}
</script>

<template>
  <InputGroupInput
    v-if="bare"
    v-bind="inputProps()"
    :class="cn('font-mono tabular-nums', props.class)"
  />
  <InputGroup v-else-if="unit" :class="props.class">
    <InputGroupInput v-bind="inputProps()" class="font-mono tabular-nums" />
    <InputGroupAddon align="inline-end">
      <InputGroupText class="font-mono text-xs">{{ unit }}</InputGroupText>
    </InputGroupAddon>
  </InputGroup>
  <Input v-else v-bind="inputProps()" :class="cn('font-mono tabular-nums', props.class)" />
</template>
