<script setup lang="ts">
/**
 * Plain text with the case-insensitive matches of one or more search terms marked (the same
 * mark style as `TopicLabel`).
 */
import { computed } from 'vue'
import { highlightParts } from '@/utils/highlight'

const props = withDefaults(
  defineProps<{
    text: string
    /** Term(s) to mark; empty terms mark nothing. */
    terms: string | readonly string[]
    /** Matches marked at most (long previews stay cheap). */
    maxMarks?: number
  }>(),
  { maxMarks: Number.POSITIVE_INFINITY }
)

const parts = computed(() => highlightParts(props.text, props.terms, props.maxMarks))
</script>

<template>
  <span
    ><template v-for="(part, index) in parts" :key="index"
      ><mark v-if="part.match" class="rounded-[2px] bg-warning/30 text-inherit">{{
        part.text
      }}</mark
      ><template v-else>{{ part.text }}</template></template
    ></span
  >
</template>
