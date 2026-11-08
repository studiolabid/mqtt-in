<script setup lang="ts">
/**
 * A boolean option as a bordered row (title, description, switch); the whole row toggles.
 * The row is tinted with the accent while on; `tone="warning"` flags a risky state.
 * Attributes go to the switch.
 */
import { useId, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle
} from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    title: string
    description?: string
    tone?: 'default' | 'warning'
    disabled?: boolean
    class?: HTMLAttributes['class']
  }>(),
  { tone: 'default', disabled: false }
)

const model = defineModel<boolean>({ default: false })
const id = useId()
</script>

<template>
  <FieldLabel
    :for="id"
    :class="
      cn(
        'w-full transition-colors',
        tone === 'warning'
          ? 'border-warning/40 bg-warning/5 dark:bg-warning/10'
          : 'has-[[data-state=checked]]:border-primary/30 has-[[data-state=checked]]:bg-primary/5 dark:has-[[data-state=checked]]:border-primary/20 dark:has-[[data-state=checked]]:bg-primary/10',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        props.class
      )
    "
  >
    <Field
      orientation="horizontal"
      :data-disabled="disabled ? 'true' : undefined"
      class="items-center gap-3"
    >
      <FieldContent class="min-w-0">
        <FieldTitle class="gap-1.5">
          <slot name="icon" />
          {{ title }}
        </FieldTitle>
        <FieldDescription v-if="description || $slots.description" class="text-xs">
          <slot name="description">{{ description }}</slot>
        </FieldDescription>
      </FieldContent>
      <Switch :id="id" v-bind="$attrs" v-model="model" :disabled="disabled" />
    </Field>
  </FieldLabel>
</template>
