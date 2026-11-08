<script setup lang="ts">
/**
 * Icon-only button with a tooltip (label + optional shortcut hint). The label is also the
 * accessible name. Attributes and listeners (`data-testid`, `@click`…) go to the button.
 */
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { Button, type ButtonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import KbdShortcut from './KbdShortcut.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    label: string
    /** Keys for `KbdShortcut`, e.g. `SHORTCUTS.clearMessages.keys`. */
    shortcut?: readonly string[]
    side?: 'top' | 'right' | 'bottom' | 'left'
    variant?: ButtonVariants['variant']
    size?: ButtonVariants['size']
    disabled?: boolean
    class?: HTMLAttributes['class']
  }>(),
  { side: 'bottom', variant: 'ghost', size: 'icon-sm', disabled: false }
)
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <Button
        v-bind="$attrs"
        type="button"
        :variant="variant"
        :size="size"
        :disabled="disabled"
        :aria-label="label"
        :class="cn('text-muted-foreground hover:text-foreground', props.class)"
      >
        <slot />
      </Button>
    </TooltipTrigger>
    <TooltipContent :side="side">
      {{ label }}
      <KbdShortcut v-if="shortcut" :keys="shortcut" />
    </TooltipContent>
  </Tooltip>
</template>
