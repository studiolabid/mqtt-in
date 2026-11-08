<script setup lang="ts">
/**
 * Platform-aware shortcut hint, e.g. `keys=['Mod', 'K']` → `⌘ K` on macOS, `Ctrl K` elsewhere.
 * Display only: registering the hotkey is up to the caller.
 */
import { computed, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { formatShortcut, formatShortcutKey, isMacPlatform } from './lib/shortcut'

const props = defineProps<{
  keys: readonly string[]
  /** `process.platform` value or `mac…`; detected from the user agent when omitted. */
  platform?: string
  class?: HTMLAttributes['class']
}>()

const mac = computed(() => isMacPlatform(props.platform))
const labels = computed(() => props.keys.map((key) => formatShortcutKey(key, mac.value)))
const text = computed(() => formatShortcut(props.keys, mac.value ? 'darwin' : 'other'))
</script>

<template>
  <KbdGroup data-slot="kbd-shortcut" :class="cn(props.class)" :title="text">
    <span class="sr-only">{{ text }}</span>
    <Kbd v-for="(label, index) in labels" :key="index" aria-hidden="true">{{ label }}</Kbd>
  </KbdGroup>
</template>
