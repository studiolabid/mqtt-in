<script setup lang="ts">
/**
 * Hover actions of a message row. Rendered for the hovered row only (keeps virtualized rows
 * light); the bar takes the row's background and fades the text under its left edge.
 */
import { CopyIcon, HashIcon, SquarePenIcon } from '@lucide/vue'
import { IconButton } from '@/components/common'
import type { RowAction } from '../types'

const emit = defineEmits<{ action: [action: RowAction] }>()
</script>

<template>
  <div
    class="row-actions absolute inset-y-0 right-0 flex items-center gap-0.5 bg-inherit pr-2 pl-8 animate-in fade-in-0 duration-100"
    @pointerdown.stop
    @click.stop
    @dblclick.stop
  >
    <IconButton
      label="Copy payload"
      side="top"
      size="icon-xs"
      @click="emit('action', 'copy-payload')"
    >
      <CopyIcon />
    </IconButton>
    <IconButton label="Copy topic" side="top" size="icon-xs" @click="emit('action', 'copy-topic')">
      <HashIcon />
    </IconButton>
    <IconButton label="Edit & publish" side="top" size="icon-xs" @click="emit('action', 'edit')">
      <SquarePenIcon />
    </IconButton>
  </div>
</template>

<style scoped>
.row-actions {
  mask-image: linear-gradient(to right, transparent, black 1.75rem);
}
</style>
