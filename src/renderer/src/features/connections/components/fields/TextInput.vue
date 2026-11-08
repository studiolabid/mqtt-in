<script setup lang="ts">
/**
 * `Input` with a string `v-model` (the shadcn Input emits `string | number`). `bare` renders
 * the borderless variant for use inside an `InputGroup`. Attributes go to the <input>.
 */
import type { HTMLAttributes } from 'vue'
import { Input } from '@/components/ui/input'
import { InputGroupInput } from '@/components/ui/input-group'

const props = withDefaults(
  defineProps<{
    bare?: boolean
    class?: HTMLAttributes['class']
  }>(),
  { bare: false }
)

const model = defineModel<string>({ default: '' })

function onUpdate(value: string | number): void {
  model.value = String(value)
}
</script>

<template>
  <component
    :is="bare ? InputGroupInput : Input"
    :model-value="model"
    autocomplete="off"
    spellcheck="false"
    :class="props.class"
    @update:model-value="onUpdate"
  />
</template>
