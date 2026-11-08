<script setup lang="ts">
/**
 * Compact keyboard cheat sheet of the welcome screen: the four essentials (command palette, new
 * connection, new subscription, publish) and a link to every shortcut (UX-15).
 */
import { KeyboardIcon } from '@lucide/vue'
import { KbdShortcut } from '@/components/common'
import { Button } from '@/components/ui/button'
import { hostPlatform } from '@/composables'
import { SHORTCUTS, type ShortcutDefinition } from '@/utils/shortcuts'
import { useShortcutsDialog } from '../../composables/useShortcutsDialog'

const ESSENTIALS: readonly ShortcutDefinition[] = [
  SHORTCUTS.commandPalette,
  SHORTCUTS.newConnection,
  SHORTCUTS.newSubscription,
  SHORTCUTS.publish
]

const platform = hostPlatform()
const shortcuts = useShortcutsDialog()
</script>

<template>
  <section aria-labelledby="welcome-keyboard" class="@container min-w-0">
    <div class="mb-1 flex items-center justify-between gap-2">
      <h2 id="welcome-keyboard" class="text-xs font-medium text-muted-foreground">Keyboard</h2>
      <Button variant="ghost" size="xs" class="-mr-2 text-muted-foreground" @click="shortcuts.show">
        <KeyboardIcon data-icon="inline-start" />
        All shortcuts
      </Button>
    </div>
    <ul class="grid gap-x-10 @lg:grid-cols-2">
      <li
        v-for="item in ESSENTIALS"
        :key="item.label"
        class="flex h-8 items-center justify-between gap-4 border-b border-dashed text-[13px]"
      >
        <span class="min-w-0 truncate">{{ item.label }}</span>
        <KbdShortcut :keys="item.keys" :platform="platform" class="shrink-0" />
      </li>
    </ul>
  </section>
</template>
