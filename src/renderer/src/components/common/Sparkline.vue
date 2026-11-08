<script setup lang="ts">
/**
 * Tiny inline trend: line + soft gradient area + end dot, no axes. Long series are reduced
 * to their min / max envelope; empty input draws a faint baseline, constant input a flat line.
 * Decorative by default (`aria-hidden`); pass `label` to expose it as an image.
 */
import { computed, useId, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { sparklineGeometry } from './lib/sparkline'

const props = withDefaults(
  defineProps<{
    values: readonly number[]
    /** Any CSS color, e.g. a hex or `var(--incoming)`. */
    color?: string
    width?: number
    height?: number
    /** Accessible description, e.g. `Messages per second, last minute`. */
    label?: string
    class?: HTMLAttributes['class']
  }>(),
  { color: 'var(--primary)', width: 64, height: 20 }
)

const gradientId = `spark-${useId()}`
const geometry = computed(() => sparklineGeometry(props.values, props.width, props.height))
</script>

<template>
  <svg
    data-slot="sparkline"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    fill="none"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
    :class="cn('shrink-0 overflow-visible', props.class)"
  >
    <template v-if="geometry.last">
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" :style="{ stopColor: color, stopOpacity: 0.24 }" />
          <stop offset="100%" :style="{ stopColor: color, stopOpacity: 0 }" />
        </linearGradient>
      </defs>
      <path :d="geometry.area" :fill="`url(#${gradientId})`" />
      <path
        :d="geometry.line"
        :style="{ stroke: color }"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
      <circle :cx="geometry.last.x" :cy="geometry.last.y" r="1.75" :style="{ fill: color }" />
    </template>
    <line
      v-else
      x1="0"
      :y1="height - 0.5"
      :x2="width"
      :y2="height - 0.5"
      class="stroke-border"
      stroke-width="1"
    />
  </svg>
</template>
