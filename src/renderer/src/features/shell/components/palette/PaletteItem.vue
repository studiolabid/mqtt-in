<script setup lang="ts">
/**
 * One command palette entry: icon, label, optional muted hint and shortcut. Search matches the
 * rendered text plus hidden `keywords`. Slots: `icon`, default (label), `trailing`.
 */
import type { Component } from 'vue'
import { KbdShortcut } from '@/components/common'
import { CommandItem, CommandShortcut } from '@/components/ui/command'
import { hostPlatform } from '@/composables'

defineProps<{
  value: string
  label: string
  icon?: Component
  keys?: readonly string[]
  hint?: string
  keywords?: string
  disabled?: boolean
}>()

const emit = defineEmits<{ select: [] }>()

const platform = hostPlatform()
</script>

<template>
  <CommandItem
    :value="value"
    :disabled="disabled"
    class="h-9 gap-2.5 px-2.5 data-disabled:pointer-events-none data-disabled:opacity-50"
    @select="emit('select')"
  >
    <slot name="icon">
      <component
        :is="icon"
        v-if="icon"
        class="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </slot>
    <span class="min-w-0 flex-1 truncate">
      <slot>{{ label }}</slot>
    </span>
    <span v-if="keywords" hidden>{{ ` ${keywords} ` }}</span>
    <!-- Always present: it also hides the listbox check mark of CommandItem. -->
    <CommandShortcut class="flex min-w-0 shrink-0 items-center gap-2 tracking-normal">
      <slot name="trailing">
        <span v-if="hint" class="max-w-52 truncate font-mono text-[11px]">{{ hint }}</span>
        <KbdShortcut v-if="keys" :keys="keys" :platform="platform" />
      </slot>
    </CommandShortcut>
  </CommandItem>
</template>
