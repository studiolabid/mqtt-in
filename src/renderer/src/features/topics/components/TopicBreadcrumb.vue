<script setup lang="ts">
/**
 * The full topic as a breadcrumb: every parent level is a button that selects that branch.
 * Monospace, muted separators, wraps anywhere (clamped to three lines with the full topic as
 * tooltip).
 */
import { computed } from 'vue'
import { topicLevels } from '../utils/topic-path'

const props = defineProps<{ topic: string }>()

const emit = defineEmits<{ select: [topic: string] }>()

const levels = computed(() => topicLevels(props.topic))
</script>

<template>
  <nav
    aria-label="Topic path"
    :title="topic"
    class="line-clamp-3 font-mono text-sm leading-5 wrap-anywhere select-text"
  >
    <template v-for="(level, index) in levels" :key="index">
      <span v-if="index > 0" class="text-muted-foreground" aria-hidden="true">/</span>
      <button
        v-if="index < levels.length - 1"
        type="button"
        class="max-w-full truncate rounded-[3px] align-bottom text-muted-foreground underline-offset-2 transition-colors outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        :title="`Show ${level.topic || '(empty level)'}`"
        @click="emit('select', level.topic)"
      >
        <template v-if="level.name">{{ level.name }}</template>
        <span v-else class="italic">∅</span>
      </button>
      <span v-else class="font-medium text-foreground" aria-current="page">
        <template v-if="level.name">{{ level.name }}</template>
        <span v-else class="text-muted-foreground italic">(empty)</span>
      </span>
    </template>
  </nav>
</template>
