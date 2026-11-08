<script setup lang="ts">
/**
 * Single-line JSON syntax coloring for previews (message rows). Tokenizes at most ~300
 * characters with a forgiving scanner; anything that does not start like JSON renders as
 * plain text. Uses the same `--syntax-*` colors as CodeEditor.
 */
import { computed, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { isJsonLike, tokenizeJsonInline, type JsonTokenKind } from './lib/json-tokens'
import './syntax.css'

const props = defineProps<{
  text: string
  class?: HTMLAttributes['class']
}>()

const TOKEN_CLASS: Readonly<Record<JsonTokenKind, string | undefined>> = {
  key: 'text-(--syntax-key)',
  string: 'text-(--syntax-string)',
  number: 'text-(--syntax-number)',
  bool: 'text-(--syntax-bool)',
  null: 'text-(--syntax-null) italic',
  punct: 'text-(--syntax-punct)',
  plain: undefined
}

const tokens = computed(() => (isJsonLike(props.text) ? tokenizeJsonInline(props.text) : null))
</script>

<template>
  <span data-slot="json-inline" :class="cn('font-mono', props.class)">
    <template v-if="tokens">
      <span v-for="(token, index) in tokens" :key="index" :class="TOKEN_CLASS[token.kind]">{{
        token.text
      }}</span>
    </template>
    <template v-else>{{ text }}</template>
  </span>
</template>
