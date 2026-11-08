<script setup lang="ts">
/**
 * Tooltip around a single trigger element (rendered `as-child`): a label and an optional
 * shortcut hint. Like every tooltip it opens on hover and keyboard focus only (the app's
 * `TooltipProvider` ignores focus moved by code or restored by a closing popover).
 */
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import KbdShortcut from './KbdShortcut.vue'

withDefaults(
  defineProps<{
    label: string
    keys?: readonly string[]
    side?: 'top' | 'right' | 'bottom' | 'left'
    disabled?: boolean
  }>(),
  { side: 'top', disabled: false }
)
</script>

<template>
  <Tooltip :disabled="disabled">
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>
    <TooltipContent :side="side" :side-offset="6">
      <span>{{ label }}</span>
      <KbdShortcut v-if="keys" :keys="keys" title="" />
    </TooltipContent>
  </Tooltip>
</template>
