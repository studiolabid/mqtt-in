<script setup lang="ts">
/**
 * Cheat sheet of every keyboard shortcut (from the `SHORTCUTS` registry).
 */
import { KeyboardIcon } from '@lucide/vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { shortcutsByGroup } from '@/utils/shortcuts'
import ShortcutList from './ShortcutList.vue'

const open = defineModel<boolean>('open', { default: false })

const groups = shortcutsByGroup()
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="gap-0 p-0 duration-150 sm:max-w-2xl">
      <DialogHeader class="border-b px-5 pt-4 pb-3.5">
        <DialogTitle class="flex items-center gap-2">
          <KeyboardIcon class="size-4 text-muted-foreground" aria-hidden="true" />
          Keyboard shortcuts
        </DialogTitle>
        <DialogDescription>Everything in mqtey is one keystroke away.</DialogDescription>
      </DialogHeader>
      <div class="scrollbar-slim max-h-[min(34rem,70vh)] overflow-y-auto px-5 pt-3 pb-5">
        <ShortcutList :groups="groups" />
      </div>
    </DialogContent>
  </Dialog>
</template>
