<script setup lang="ts">
/**
 * Expanded detail of a log entry: JSON is pretty-printed and syntax colored, search matches
 * are highlighted, the text is selectable and can be copied.
 */
import { computed } from 'vue'
import { CopyButton } from '@/components/common'
import { highlightParts } from '@/utils/highlight'
import {
  formatDetail,
  tokenizeJson,
  type DetailToken,
  type DetailTokenKind
} from '../utils/text-parts'

const props = defineProps<{
  detail: string
  search: string
}>()

const TOKEN_CLASS: Readonly<Record<DetailTokenKind, string | undefined>> = {
  key: 'token-key',
  string: 'token-string',
  number: 'token-number',
  bool: 'token-bool',
  null: 'token-null',
  punct: 'token-punct',
  plain: undefined
}

const formatted = computed(() => formatDetail(props.detail))

const tokens = computed<DetailToken[]>(() =>
  formatted.value.json
    ? tokenizeJson(formatted.value.text)
    : [{ kind: 'plain', text: formatted.value.text }]
)

const segments = computed(() =>
  tokens.value.map((token) => ({
    className: TOKEN_CLASS[token.kind],
    parts: highlightParts(token.text, props.search)
  }))
)
</script>

<template>
  <div
    data-slot="log-detail"
    class="group/detail relative mt-1 mb-0.5 rounded-md border bg-muted/40 dark:bg-muted/25"
  >
    <div
      class="scrollbar-slim max-h-72 overflow-auto py-1.5 pr-8 pl-2.5 font-mono text-[11.5px] leading-[1.125rem] whitespace-pre-wrap text-foreground/85 select-text wrap-anywhere"
    >
      <span v-for="(segment, index) in segments" :key="index" :class="segment.className">
        <template v-for="(part, partIndex) in segment.parts" :key="partIndex">
          <mark v-if="part.match" class="search-match">{{ part.text }}</mark>
          <template v-else>{{ part.text }}</template>
        </template>
      </span>
    </div>
    <CopyButton
      :value="detail"
      label="detail"
      class="absolute top-1 right-1 bg-muted/80 opacity-0 backdrop-blur-sm transition-opacity group-hover/detail:opacity-100 focus-visible:opacity-100"
    />
  </div>
</template>

<style scoped>
/* Same palette as the CodeEditor / JsonInline syntax colors, with token fallbacks. */
.token-key {
  color: var(--syntax-key, var(--info));
}
.token-string {
  color: var(--syntax-string, var(--success));
}
.token-number {
  color: var(--syntax-number, var(--warning));
}
.token-bool {
  color: var(--syntax-bool, var(--primary));
}
.token-null {
  color: var(--syntax-null, var(--muted-foreground));
  font-style: italic;
}
.token-punct {
  color: var(--syntax-punct, var(--muted-foreground));
}
.search-match {
  border-radius: 2px;
  background-color: color-mix(in oklch, var(--warning) 32%, transparent);
  color: inherit;
}
</style>
