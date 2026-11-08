<script setup lang="ts">
/**
 * Optional whole-number input for MQTT 5 properties. Keeps what the user typed, emits the
 * number when it is valid (in `[min, max]`) and `undefined` when empty or invalid (= not sent).
 */
import { computed, ref, watch } from 'vue'
import { Input } from '@/components/ui/input'
import { parseWholeNumber } from '../utils/properties'

const props = defineProps<{
  modelValue: number | undefined
  min: number
  max: number
  id?: string
  placeholder?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: number | undefined] }>()

const text = ref(props.modelValue === undefined ? '' : String(props.modelValue))

// Follow external changes (history entry loaded, properties cleared) unless they only echo
// what is typed.
watch(
  () => props.modelValue,
  (value) => {
    const parsed = parseWholeNumber(text.value, props.min, props.max)
    if ((parsed ?? undefined) !== value) text.value = value === undefined ? '' : String(value)
  }
)

const invalid = computed(() => parseWholeNumber(text.value, props.min, props.max) === null)

function onInput(value: string | number): void {
  text.value = String(value)
  emit('update:modelValue', parseWholeNumber(text.value, props.min, props.max) ?? undefined)
}
</script>

<template>
  <Input
    :id="id"
    :model-value="text"
    inputmode="numeric"
    autocomplete="off"
    :placeholder="placeholder"
    :aria-invalid="invalid || undefined"
    :title="invalid ? `A whole number from ${min} to ${max.toLocaleString()}` : undefined"
    class="h-7 px-2 font-mono text-xs tabular-nums md:text-xs"
    @update:model-value="onInput"
  />
</template>
