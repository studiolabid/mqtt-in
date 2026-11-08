<script setup lang="ts">
/**
 * In-page navigation of the settings sections with a sliding indicator on the current one.
 */
import { computed } from 'vue'
import { cn } from '@/lib/utils'
import type { SettingsSectionId, SettingsSectionInfo } from '../utils/options'

const props = defineProps<{
  sections: readonly SettingsSectionInfo[]
  active: SettingsSectionId
}>()

const emit = defineEmits<{ select: [id: SettingsSectionId] }>()

/** Item height (h-8) + gap (gap-0.5) in px: drives the indicator position. */
const ITEM_STRIDE = 34

const activeIndex = computed(() =>
  Math.max(
    0,
    props.sections.findIndex((section) => section.id === props.active)
  )
)
</script>

<template>
  <nav aria-label="Settings sections" class="relative">
    <span
      aria-hidden="true"
      class="absolute top-1.5 left-0 h-5 w-0.5 rounded-full bg-primary transition-transform duration-200 ease-out motion-reduce:transition-none"
      :style="{ transform: `translateY(${activeIndex * ITEM_STRIDE}px)` }"
    />
    <ul class="flex flex-col gap-0.5">
      <li v-for="section in sections" :key="section.id">
        <button
          type="button"
          :aria-current="section.id === active ? 'true' : undefined"
          :class="
            cn(
              'flex h-8 w-full items-center gap-2.5 rounded-md pr-2 pl-3.5 text-left text-[13px] text-muted-foreground transition-colors outline-none hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
              section.id === active && 'font-medium text-foreground'
            )
          "
          @click="emit('select', section.id)"
        >
          <component :is="section.icon" class="size-4 shrink-0" aria-hidden="true" />
          <span class="truncate">{{ section.label }}</span>
        </button>
      </li>
    </ul>
  </nav>
</template>
