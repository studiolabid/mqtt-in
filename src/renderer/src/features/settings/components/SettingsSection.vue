<script setup lang="ts">
/**
 * A settings section: heading + description above a bordered card that holds the rows
 * (`SettingsRow`), separated by hairlines.
 */
import { useId, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { sectionDomId, type SettingsSectionId } from '../utils/options'

const props = defineProps<{
  id: SettingsSectionId
  title: string
  description?: string
  /** Classes of the card. */
  class?: HTMLAttributes['class']
}>()

const headingId = useId()
</script>

<template>
  <section :id="sectionDomId(props.id)" :aria-labelledby="headingId" class="scroll-mt-8">
    <header class="mb-3 flex items-end justify-between gap-4 px-0.5">
      <div class="min-w-0">
        <h2
          :id="headingId"
          data-section-heading
          tabindex="-1"
          class="text-[15px] font-semibold tracking-tight outline-none"
        >
          {{ title }}
        </h2>
        <p v-if="description" class="mt-0.5 text-[13px] text-muted-foreground">
          {{ description }}
        </p>
      </div>
      <slot name="actions" />
    </header>
    <div
      :class="
        cn(
          'divide-y overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs',
          props.class
        )
      "
    >
      <slot />
    </div>
  </section>
</template>
