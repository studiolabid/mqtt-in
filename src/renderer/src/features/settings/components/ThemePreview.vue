<script setup lang="ts">
/**
 * Miniature mqtey window (title bar, connection sidebar, tabs, message rows, publish bar) in
 * light or dark. Drawn with tokens only: `--paper` / `--ink` swap `--background` and
 * `--foreground` depending on the current mode, so both variants render truthfully in either
 * theme; the accent comes from `--primary`. `split` keeps a diagonal right part (System tile).
 */
defineProps<{
  variant: 'light' | 'dark'
  split?: boolean
}>()

/**
 * Paper / ink per variant. Uses the `dark:` variant (not `:global(.dark)` in scoped CSS, which
 * Vue compiles to a bare `.dark` selector).
 */
const PALETTES = {
  light:
    '[--paper:var(--background)] [--ink:var(--foreground)] dark:[--paper:var(--foreground)] dark:[--ink:var(--background)]',
  dark: '[--paper:var(--foreground)] [--ink:var(--background)] dark:[--paper:var(--background)] dark:[--ink:var(--foreground)]'
} as const

const ROWS = [
  { dot: 'bg-incoming', topic: 'w-[30%]', payload: 'w-[44%]' },
  { dot: 'bg-incoming', topic: 'w-[22%]', payload: 'w-[56%]' },
  { dot: 'bg-outgoing', topic: 'w-[36%]', payload: 'w-[28%]' },
  { dot: 'bg-incoming', topic: 'w-[26%]', payload: 'w-[48%]' },
  { dot: 'bg-incoming', topic: 'w-[32%]', payload: 'w-[36%]' }
] as const
</script>

<template>
  <div
    aria-hidden="true"
    :class="['preview absolute inset-0 flex flex-col', PALETTES[variant], split && 'preview-split']"
  >
    <div class="preview-line-b flex h-3 shrink-0 items-center gap-[3px] px-2">
      <span class="preview-ink-25 size-1 rounded-full" />
      <span class="preview-ink-25 size-1 rounded-full" />
      <span class="preview-ink-25 size-1 rounded-full" />
    </div>
    <div class="flex min-h-0 flex-1">
      <div class="preview-sidebar flex w-[30%] shrink-0 flex-col gap-1 px-1.5 pt-1.5">
        <span class="flex h-2.5 items-center gap-1 rounded-[3px] bg-primary/15 px-1">
          <span class="size-1 shrink-0 rounded-full bg-success" />
          <span class="h-[3px] flex-1 rounded-full bg-primary/70" />
        </span>
        <span class="flex h-2.5 items-center gap-1 px-1">
          <span class="preview-ink-25 size-1 shrink-0 rounded-full" />
          <span class="preview-ink-15 h-[3px] w-3/5 rounded-full" />
        </span>
        <span class="flex h-2.5 items-center gap-1 px-1">
          <span class="preview-ink-25 size-1 shrink-0 rounded-full" />
          <span class="preview-ink-15 h-[3px] w-2/5 rounded-full" />
        </span>
      </div>
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="preview-line-b flex h-3 shrink-0 items-end gap-1.5 px-2">
          <span class="h-[3px] w-4 rounded-t-[1px] bg-primary" />
          <span class="preview-ink-15 mb-1 h-[3px] w-3 rounded-full" />
          <span class="preview-ink-15 mb-1 h-[3px] w-3 rounded-full" />
        </div>
        <div class="flex flex-1 flex-col justify-evenly px-2">
          <div v-for="(row, index) in ROWS" :key="index" class="flex items-center gap-1">
            <span :class="['size-1 shrink-0 rounded-full', row.dot]" />
            <span :class="['preview-ink-30 h-[3px] rounded-full', row.topic]" />
            <span :class="['preview-ink-12 h-[3px] rounded-full', row.payload]" />
          </div>
        </div>
        <div class="preview-line-t flex h-[24%] shrink-0 items-center gap-1 px-2">
          <span class="preview-field h-2.5 flex-1 rounded-[3px]" />
          <span class="h-2.5 w-5 shrink-0 rounded-[3px] bg-primary" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preview {
  background-color: var(--paper);
}
.preview-split {
  clip-path: polygon(62% 0, 100% 0, 100% 100%, 38% 100%);
}
.preview-line-b {
  border-bottom: 1px solid color-mix(in oklch, var(--ink) 10%, transparent);
}
.preview-line-t {
  border-top: 1px solid color-mix(in oklch, var(--ink) 10%, transparent);
}
.preview-sidebar {
  background-color: color-mix(in oklch, var(--ink) 3.5%, var(--paper));
  border-right: 1px solid color-mix(in oklch, var(--ink) 10%, transparent);
}
.preview-field {
  border: 1px solid color-mix(in oklch, var(--ink) 16%, transparent);
}
.preview-ink-12 {
  background-color: color-mix(in oklch, var(--ink) 12%, transparent);
}
.preview-ink-15 {
  background-color: color-mix(in oklch, var(--ink) 15%, transparent);
}
.preview-ink-25 {
  background-color: color-mix(in oklch, var(--ink) 25%, transparent);
}
.preview-ink-30 {
  background-color: color-mix(in oklch, var(--ink) 30%, transparent);
}
</style>
