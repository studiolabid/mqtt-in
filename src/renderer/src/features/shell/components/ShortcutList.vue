<script setup lang="ts">
/**
 * Keyboard shortcuts grouped as in the `SHORTCUTS` registry (welcome cheat sheet and the
 * shortcuts dialog). Wraps into two columns when its container is wide enough.
 */
import { KbdShortcut } from '@/components/common'
import { hostPlatform } from '@/composables'
import type { ShortcutDefinition, ShortcutGroup } from '@/utils/shortcuts'

defineProps<{
  groups: ReadonlyArray<{ group: ShortcutGroup; items: readonly ShortcutDefinition[] }>
}>()

const platform = hostPlatform()
</script>

<template>
  <div class="@container">
    <div class="grid gap-x-10 gap-y-5 @lg:grid-cols-2">
      <section v-for="group in groups" :key="group.group" :aria-label="group.group">
        <h3 class="mb-1.5 text-xs font-medium text-muted-foreground">{{ group.group }}</h3>
        <ul>
          <li
            v-for="item in group.items"
            :key="item.combo"
            class="flex h-8 items-center justify-between gap-4 border-b border-dashed text-[13px] last:border-b-0"
          >
            <span class="min-w-0 truncate">{{ item.label }}</span>
            <KbdShortcut :keys="item.keys" :platform="platform" class="shrink-0" />
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
