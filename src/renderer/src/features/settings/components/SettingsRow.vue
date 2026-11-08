<script setup lang="ts">
/**
 * One setting: label + description with the control beside or below them.
 *
 * `layout`: `auto` (beside when the content column is wide enough, else below), `inline`
 * (always beside: small controls such as switches) or `stacked` (always below, full width).
 * `for` links the label to the control so clicking the label operates it.
 */
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    label: string
    description?: string
    /** Id of the control the label belongs to. */
    for?: string
    layout?: 'auto' | 'inline' | 'stacked'
    class?: HTMLAttributes['class']
  }>(),
  { layout: 'auto' }
)
</script>

<template>
  <div
    data-slot="settings-row"
    :class="
      cn(
        'flex gap-x-8 gap-y-3 px-4 py-3.5',
        props.layout === 'inline' && 'flex-row items-center',
        props.layout === 'stacked' && 'flex-col',
        props.layout === 'auto' && 'flex-col @xl/settings:flex-row @xl/settings:items-center',
        props.class
      )
    "
  >
    <div class="min-w-0 flex-1">
      <component
        :is="props.for ? 'label' : 'div'"
        :for="props.for"
        class="block text-sm leading-5 font-medium"
      >
        {{ label }}
      </component>
      <p
        v-if="description || $slots.description"
        class="mt-0.5 text-[13px] leading-5 text-pretty text-muted-foreground"
      >
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <div
      v-if="$slots.default"
      :class="
        cn(
          'flex min-w-0 items-center gap-2',
          props.layout === 'stacked' ? 'w-full' : 'shrink-0 flex-wrap'
        )
      "
    >
      <slot />
    </div>
  </div>
</template>
