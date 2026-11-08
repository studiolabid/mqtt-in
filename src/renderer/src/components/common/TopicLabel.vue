<script setup lang="ts">
/**
 * Monospace topic with muted `/` separators (muted text, no transparency: the separators are part
 * of the topic and stay readable), accented `+` / `#` wildcards, dimmed `$` system topics and an
 * optional case-insensitive highlight. Truncates with the full topic as native tooltip (or wraps
 * anywhere when `truncate` is false). Text is selectable.
 */
import { computed, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { segmentTopic, type TopicPartKind } from './lib/topic-segments'

const props = withDefaults(
  defineProps<{
    topic: string
    /** Substring to mark (case-insensitive). */
    highlight?: string
    truncate?: boolean
    class?: HTMLAttributes['class']
  }>(),
  { highlight: '', truncate: true }
)

const KIND_CLASS: Readonly<Record<TopicPartKind, string | undefined>> = {
  text: undefined,
  separator: 'text-muted-foreground',
  wildcard: 'font-semibold text-primary-text'
}

const parts = computed(() => segmentTopic(props.topic, props.highlight))
const system = computed(() => props.topic.startsWith('$'))
</script>

<template>
  <span
    data-slot="topic-label"
    :title="truncate && topic ? topic : undefined"
    :class="
      cn(
        'font-mono select-text',
        truncate ? 'block min-w-0 truncate' : 'wrap-anywhere',
        system && 'text-muted-foreground',
        props.class
      )
    "
  >
    <span v-if="!topic" class="text-muted-foreground italic">(empty topic)</span>
    <template v-else>
      <template v-for="(part, index) in parts" :key="index">
        <mark
          v-if="part.highlighted"
          :class="cn('rounded-[2px] bg-warning/30 text-inherit', KIND_CLASS[part.kind])"
          >{{ part.text }}</mark
        >
        <span v-else-if="part.kind !== 'text'" :class="KIND_CLASS[part.kind]">{{ part.text }}</span>
        <template v-else>{{ part.text }}</template>
      </template>
    </template>
  </span>
</template>
