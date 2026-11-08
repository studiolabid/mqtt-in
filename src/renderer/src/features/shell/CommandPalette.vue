<script setup lang="ts">
/**
 * Command palette (singleton, Mod+K): connections (open, connect / disconnect), actions, quick
 * start presets and help. Also hosts the keyboard shortcuts dialog.
 *
 * Selecting an entry closes the palette, gives keyboard focus back to where it was before the
 * palette opened, then runs the entry (`usePaletteFocus`): focus never ends on `<body>`, and a
 * dialog the entry opens returns there when it closes.
 */
import { computed } from 'vue'
import { ArrowDownIcon, ArrowUpIcon, CornerDownLeftIcon } from '@lucide/vue'
import { ConnectionAvatar, StatusDot } from '@/components/common'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { isModalOpen, useHotkey } from '@/composables'
import { useUiStore } from '@/stores'
import { SHORTCUTS } from '@/utils/shortcuts'
import PaletteItem from './components/palette/PaletteItem.vue'
import ShortcutsDialog from './components/ShortcutsDialog.vue'
import { usePaletteCommands, type PaletteCommand } from './composables/usePaletteCommands'
import { usePaletteFocus } from './composables/usePaletteFocus'
import { useShortcutsDialog } from './composables/useShortcutsDialog'

const ui = useUiStore()
const { connections, actions, presets, help, openConnection } = usePaletteCommands()
const { open: shortcutsOpen } = useShortcutsDialog()

const open = computed({
  get: () => ui.commandPaletteOpen,
  set: (value: boolean) => {
    ui.commandPaletteOpen = value
  }
})

/** Group headings (the stock command group styles target cmdk attributes). */
const GROUP_CLASS =
  '**:data-[slot=command-group-heading]:px-2.5 **:data-[slot=command-group-heading]:pt-2 **:data-[slot=command-group-heading]:pb-1 **:data-[slot=command-group-heading]:text-[11px] **:data-[slot=command-group-heading]:font-medium **:data-[slot=command-group-heading]:text-muted-foreground'

const focus = usePaletteFocus(() => ui.commandPaletteOpen)

useHotkey(SHORTCUTS.commandPalette.combo, toggle, { allowInInputs: true })

function toggle(): void {
  if (ui.commandPaletteOpen) ui.commandPaletteOpen = false
  else if (!isModalOpen()) ui.commandPaletteOpen = true
}

function report(err: unknown): void {
  console.error('[mqtey] command failed:', err)
}

async function run(action: () => unknown): Promise<void> {
  ui.commandPaletteOpen = false
  await focus.restore()
  try {
    await action()
  } catch (err) {
    report(err)
  }
}

function runCommand(command: PaletteCommand): void {
  void run(() => command.run())
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      data-testid="command-palette"
      :show-close-button="false"
      class="top-[14%] translate-y-0 gap-0 overflow-hidden p-0 duration-150 data-open:zoom-in-98 data-closed:zoom-out-98 sm:max-w-xl"
      @close-auto-focus="focus.onCloseAutoFocus"
    >
      <DialogHeader class="sr-only">
        <DialogTitle>Command palette</DialogTitle>
        <DialogDescription>Search connections and commands</DialogDescription>
      </DialogHeader>
      <Command class="rounded-none! bg-transparent">
        <CommandInput placeholder="Search connections & commands…" />
        <CommandList class="scrollbar-slim mt-1 max-h-[min(24rem,58vh)]">
          <CommandEmpty class="py-8 text-muted-foreground">
            No connection or command matches.
          </CommandEmpty>

          <CommandGroup v-if="connections.length > 0" heading="Connections" :class="GROUP_CLASS">
            <PaletteItem
              v-for="entry in connections"
              :key="`open:${entry.profile.id}:${entry.profile.name}`"
              :value="`open:${entry.profile.id}`"
              :label="entry.profile.name"
              @select="run(() => openConnection(entry.profile.id))"
            >
              <template #icon>
                <ConnectionAvatar
                  :name="entry.profile.name"
                  :color="entry.profile.color"
                  :status="entry.status"
                  size="xs"
                  class="[--avatar-surface:var(--popover)]"
                />
              </template>
              <template #trailing>
                <span
                  v-if="entry.current"
                  class="rounded-sm bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary-text"
                >
                  Open
                </span>
                <span class="max-w-56 truncate font-mono text-[11px]">{{ entry.url }}</span>
              </template>
            </PaletteItem>
            <PaletteItem
              v-for="entry in connections"
              :key="`${entry.session.id}:${entry.session.label}`"
              :value="entry.session.id"
              :label="entry.session.label"
              :icon="entry.session.icon"
              :keywords="entry.session.keywords"
              :disabled="entry.session.disabled"
              @select="runCommand(entry.session)"
            >
              <template #trailing>
                <StatusDot :status="entry.status" label size="xs" />
              </template>
            </PaletteItem>
          </CommandGroup>

          <CommandGroup heading="Actions" :class="GROUP_CLASS">
            <PaletteItem
              v-for="command in actions"
              :key="`${command.id}:${command.label}`"
              :value="command.id"
              :label="command.label"
              :icon="command.icon"
              :keys="command.keys"
              :hint="command.hint"
              :keywords="command.keywords"
              :disabled="command.disabled"
              @select="runCommand(command)"
            />
          </CommandGroup>

          <CommandGroup heading="Quick start" :class="GROUP_CLASS">
            <PaletteItem
              v-for="command in presets"
              :key="command.id"
              :value="command.id"
              :label="command.label"
              :icon="command.icon"
              :hint="command.hint"
              :keywords="command.keywords"
              @select="runCommand(command)"
            />
          </CommandGroup>

          <CommandGroup heading="Help" :class="GROUP_CLASS">
            <PaletteItem
              v-for="command in help"
              :key="command.id"
              :value="command.id"
              :label="command.label"
              :icon="command.icon"
              :keywords="command.keywords"
              @select="runCommand(command)"
            />
          </CommandGroup>
        </CommandList>
      </Command>
      <footer
        class="flex h-9 items-center gap-4 border-t bg-muted/30 px-3 text-[11px] text-muted-foreground"
        aria-hidden="true"
      >
        <span class="flex items-center gap-1.5">
          <span class="flex gap-0.5">
            <Kbd><ArrowUpIcon /></Kbd>
            <Kbd><ArrowDownIcon /></Kbd>
          </span>
          Navigate
        </span>
        <span class="flex items-center gap-1.5">
          <Kbd><CornerDownLeftIcon /></Kbd>
          Run
        </span>
        <span class="ml-auto flex items-center gap-1.5">
          <Kbd>Esc</Kbd>
          Close
        </span>
      </footer>
    </DialogContent>
  </Dialog>
  <ShortcutsDialog v-model:open="shortcutsOpen" />
</template>
