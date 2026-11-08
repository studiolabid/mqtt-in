<script setup lang="ts">
/**
 * QoS picker (`v-model` = 0 | 1 | 2). Compact by default (the trigger reads `QoS 1`);
 * `detailed` shows the level name on the trigger and what every level means in the menu.
 * Attributes (`id`, `data-testid`, `aria-*`) land on the trigger button, so labels can target it.
 */
import { computed, type HTMLAttributes } from 'vue'
import type { QoS } from '@shared/models'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { QOS_LEVELS, qosLevel, toQos } from './lib/qos'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    size?: 'sm' | 'default'
    disabled?: boolean
    /** Trigger `QoS 1 · At least once` and a description per level in the menu. */
    detailed?: boolean
    class?: HTMLAttributes['class']
  }>(),
  { size: 'default', disabled: false, detailed: false }
)

const model = defineModel<QoS>({ default: 0 })

// Items use string values: reka-ui treats them uniformly and `0` never looks "empty".
const value = computed({
  get: () => String(model.value),
  set: (next: unknown) => {
    const qos = toQos(next)
    if (qos !== null) model.value = qos
  }
})
const current = computed(() => qosLevel(model.value))
</script>

<template>
  <Select v-model="value" :disabled="disabled">
    <SelectTrigger
      v-bind="$attrs"
      :size="size"
      :class="cn('gap-1', size === 'sm' && 'text-xs', props.class)"
      aria-label="Quality of service"
    >
      <SelectValue :class="detailed && 'min-w-0'">
        <span>QoS</span>
        <span class="font-mono tabular-nums">{{ model }}</span>
        <span v-if="detailed" class="truncate text-muted-foreground">· {{ current.label }}</span>
      </SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectItem
        v-for="level in QOS_LEVELS"
        :key="level.value"
        :value="String(level.value)"
        :class="detailed && 'py-1.5'"
      >
        <div v-if="detailed" class="flex max-w-64 flex-col gap-0.5">
          <span>
            <span class="font-mono tabular-nums">{{ level.value }}</span>
            <span class="text-muted-foreground" aria-hidden="true"> · </span>
            {{ level.label }}
          </span>
          <span class="text-xs text-pretty text-muted-foreground">{{ level.description }}</span>
        </div>
        <template v-else>
          <span class="font-mono tabular-nums">{{ level.value }}</span>
          <span class="text-muted-foreground" aria-hidden="true">·</span>
          <span>{{ level.label }}</span>
        </template>
      </SelectItem>
    </SelectContent>
  </Select>
</template>
