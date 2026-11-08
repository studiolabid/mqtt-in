<script setup lang="ts">
/**
 * Toggle chips for the numeric fields of a topic. A selected chip carries its series color as
 * a line key (the text stays in text colors); at most `MAX_SERIES` fields can be on at once.
 * Each chip has a pin (topic + field) for the Pinned strip, shown on hover / focus and always
 * while pinned (FP-3); the chip's owner decides what pinning means (`isPinned`, `pin`).
 */
import { BookmarkIcon } from '@lucide/vue'
import { cn } from '@/lib/utils'
import { MAX_SERIES } from '../utils/palette'

withDefaults(
  defineProps<{
    fields: readonly string[]
    selection: ReadonlyMap<string, number>
    colorOf: (field: string) => string | undefined
    canSelectMore: boolean
    /** Whether a field is pinned (no pins are offered without it). */
    isPinned?: (field: string) => boolean
  }>(),
  { isPinned: undefined }
)

const emit = defineEmits<{ toggle: [field: string]; pin: [field: string] }>()
</script>

<template>
  <div
    role="group"
    aria-label="Fields to chart"
    class="flex max-h-[3.75rem] flex-wrap content-start gap-1 overflow-y-auto scrollbar-slim"
  >
    <span
      v-for="field in fields"
      :key="field"
      :class="
        cn(
          'group/chip inline-flex h-6 max-w-52 shrink-0 items-center rounded-md border text-xs transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring',
          selection.has(field)
            ? 'border-input bg-background text-foreground shadow-xs dark:bg-input/30'
            : 'border-dashed text-muted-foreground hover:bg-muted/60 hover:text-foreground'
        )
      "
    >
      <button
        type="button"
        :aria-pressed="selection.has(field)"
        :disabled="!selection.has(field) && !canSelectMore"
        :title="
          !selection.has(field) && !canSelectMore ? `Up to ${MAX_SERIES} fields at a time` : field
        "
        class="inline-flex h-full min-w-0 items-center gap-1.5 rounded-md pr-1 pl-2 outline-none disabled:cursor-not-allowed disabled:opacity-50"
        @click="emit('toggle', field)"
      >
        <span
          :class="cn('h-0.5 w-3 shrink-0 rounded-full', !selection.has(field) && 'bg-border')"
          :style="selection.has(field) ? { backgroundColor: colorOf(field) } : undefined"
          aria-hidden="true"
        />
        <span class="truncate font-mono">{{ field }}</span>
      </button>
      <button
        v-if="isPinned"
        type="button"
        data-testid="topic-pin"
        data-pin-source="chip"
        :data-field="field"
        :aria-pressed="isPinned(field)"
        :aria-label="isPinned(field) ? `Unpin ${field}` : `Pin ${field} to the top`"
        :title="isPinned(field) ? 'Unpin' : 'Pin to the top'"
        :class="
          cn(
            'mr-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground outline-none hover:bg-foreground/10 hover:text-foreground',
            isPinned(field)
              ? 'text-foreground'
              : 'opacity-0 group-hover/chip:opacity-100 focus-visible:opacity-100'
          )
        "
        @click="emit('pin', field)"
      >
        <BookmarkIcon :class="cn('size-3', isPinned(field) && 'fill-current')" aria-hidden="true" />
      </button>
    </span>
  </div>
</template>
