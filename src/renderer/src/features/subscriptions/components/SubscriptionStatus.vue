<script setup lang="ts">
/**
 * Live state glyph of a subscription, drawn in its color: a hollow ring while idle, a spinner
 * while subscribing, a filled dot with a soft halo once the broker granted it, a destructive
 * icon on failure and a muted ring when disabled. The tooltip carries the details; it opens on
 * hover, and stays open while `open` is set (the keyboard cursor is on the row, A11Y-20). The
 * row also exposes the details to screen readers (`aria-describedby`).
 */
import { ref } from 'vue'
import { CircleAlertIcon } from '@lucide/vue'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { SubscriptionGlyph } from '../utils/subscription-view'

defineProps<{
  glyph: SubscriptionGlyph
  color: string
  title: string
  /** Secondary tooltip lines. */
  details: readonly string[]
  /** Keep the tooltip open (keyboard cursor on the row). */
  open?: boolean
}>()

/** Hover state of the tooltip. */
const hovered = ref(false)

const DOT: Readonly<Record<'subscribed' | 'idle' | 'disabled', string>> = {
  subscribed: 'bg-(--sub) shadow-[0_0_0_3px_color-mix(in_oklab,var(--sub)_22%,transparent)]',
  idle: 'border-[1.5px] border-(--sub)',
  disabled: 'border-[1.5px] border-muted-foreground/45'
}
</script>

<template>
  <Tooltip :open="open || hovered" @update:open="hovered = $event">
    <TooltipTrigger as-child>
      <span
        data-slot="subscription-status"
        :data-glyph="glyph"
        role="img"
        :aria-label="title"
        :style="{ '--sub': color }"
        class="flex size-4 shrink-0 items-center justify-center"
      >
        <Spinner v-if="glyph === 'pending'" class="size-3.5 text-(--sub)" aria-hidden="true" />
        <CircleAlertIcon
          v-else-if="glyph === 'failed'"
          class="size-3.5 text-destructive animate-in fade-in-0 zoom-in-50 duration-200"
          aria-hidden="true"
        />
        <span
          v-else
          :key="glyph"
          aria-hidden="true"
          :class="['size-2 rounded-full animate-in fade-in-0 zoom-in-50 duration-200', DOT[glyph]]"
        />
      </span>
    </TooltipTrigger>
    <TooltipContent
      side="top"
      align="start"
      :side-offset="6"
      class="max-w-64 flex-col items-start gap-0.5"
    >
      <span class="font-medium">{{ title }}</span>
      <span v-for="(line, index) in details" :key="index" class="wrap-anywhere opacity-75">
        {{ line }}
      </span>
    </TooltipContent>
  </Tooltip>
</template>
