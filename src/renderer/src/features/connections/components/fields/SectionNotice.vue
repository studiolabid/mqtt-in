<script setup lang="ts">
/** Inline notice at the top of a section that does not apply yet, with a fix-it action. */
import type { Component } from 'vue'
import { Button } from '@/components/ui/button'

defineProps<{
  icon: Component
  title: string
  description: string
  actionLabel?: string
}>()

const emit = defineEmits<{ action: [] }>()
</script>

<template>
  <div
    role="note"
    class="flex items-center gap-3 rounded-lg border border-dashed bg-muted/40 px-3 py-2.5 animate-in fade-in-0 duration-150"
  >
    <span
      class="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground shadow-xs"
    >
      <component :is="icon" class="size-4" aria-hidden="true" />
    </span>
    <div class="min-w-0 flex-1">
      <p class="text-sm font-medium">{{ title }}</p>
      <p class="text-xs text-muted-foreground">{{ description }}</p>
    </div>
    <Button
      v-if="actionLabel"
      type="button"
      size="sm"
      variant="outline"
      class="shrink-0"
      @click="emit('action')"
    >
      {{ actionLabel }}
    </Button>
  </div>
</template>
