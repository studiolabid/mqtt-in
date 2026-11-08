<script setup lang="ts">
/**
 * Vertical section navigation (tabs): icon, label, a red dot for sections with errors and a
 * muted "On" for optional features in use. Active styles use the base trigger's `data-active`
 * variant, so `cn` replaces the base values (HEALTH-11).
 */
import { isTlsProtocol } from '@shared/defaults'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConnectionForm } from '../../composables/useConnectionForm'
import { FORM_SECTIONS, type FormSectionId } from '../../utils/sections'

const { draft, sectionErrors } = useConnectionForm()

function badge(id: FormSectionId): string | null {
  if (id === 'tls') return isTlsProtocol(draft.value.protocol) ? 'On' : null
  if (id === 'will') return draft.value.will.enabled ? 'On' : null
  return null
}
</script>

<template>
  <nav aria-label="Connection settings" class="w-44 shrink-0 border-r bg-muted/40 p-2">
    <TabsList
      class="flex h-auto w-full flex-col items-stretch justify-start gap-0.5 rounded-none bg-transparent p-0"
    >
      <TabsTrigger
        v-for="section in FORM_SECTIONS"
        :key="section.id"
        :value="section.id"
        :data-testid="`connection-section-${section.id}`"
        class="h-8 w-full flex-none justify-start gap-2 rounded-md px-2 text-[13px] font-normal text-muted-foreground shadow-none hover:bg-muted hover:text-foreground data-active:bg-background data-active:font-medium data-active:text-foreground data-active:shadow-xs dark:text-muted-foreground dark:hover:bg-muted/60 dark:data-active:border-input dark:data-active:bg-input/40"
      >
        <component :is="section.icon" class="size-4 shrink-0" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-left">{{ section.label }}</span>
        <template v-if="sectionErrors[section.id] > 0">
          <span class="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
          <span class="sr-only">(has errors)</span>
        </template>
        <span
          v-else-if="badge(section.id)"
          class="shrink-0 text-[11px] font-normal text-muted-foreground"
        >
          {{ badge(section.id) }}
        </span>
      </TabsTrigger>
    </TabsList>
  </nav>
</template>
