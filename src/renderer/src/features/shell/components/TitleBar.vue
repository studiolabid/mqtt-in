<script setup lang="ts">
/**
 * Custom title bar (draggable): brand + sidebar toggle, the command palette trigger centered
 * on the window, theme and settings on the right. Reserves room for the native window controls
 * (overlay on Windows / Linux, traffic lights on macOS).
 */
import { computed } from 'vue'
import {
  MoonIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  SearchIcon,
  SettingsIcon,
  SunIcon
} from '@lucide/vue'
import { AppLogo, KbdShortcut } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { hostPlatform, useNavigation } from '@/composables'
import { useSettingsStore, useUiStore } from '@/stores'
import { SHORTCUTS } from '@/utils/shortcuts'
import { useSidebarLayout } from '../composables/useSidebarLayout'

const ui = useUiStore()
const settings = useSettingsStore()
const nav = useNavigation()
const sidebar = useSidebarLayout()

const platform = hostPlatform()
const isMac = platform === 'darwin'

const themeLabel = computed(() =>
  settings.isDark ? 'Switch to light theme' : 'Switch to dark theme'
)
const sidebarLabel = computed(() => (sidebar.collapsed.value ? 'Show sidebar' : 'Hide sidebar'))

function openPalette(): void {
  ui.commandPaletteOpen = true
}
</script>

<template>
  <header
    data-testid="titlebar"
    class="drag-region relative grid h-10 shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(0,28rem)_minmax(max-content,1fr)] items-center gap-3 border-b bg-sidebar text-sidebar-foreground"
  >
    <!-- The traffic-light / overlay reserves live inside the side columns, which stay equal,
         so the palette trigger is centered on the window. -->
    <div class="flex min-w-0 items-center gap-2" :class="isMac ? 'pl-[78px]' : 'pl-3'">
      <AppLogo class="size-5" />
      <span class="text-sm font-semibold tracking-tight">mqtt-in</span>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="no-drag ml-1 text-muted-foreground"
            :aria-label="sidebarLabel"
            aria-controls="app-sidebar"
            @click="sidebar.toggle()"
          >
            <PanelLeftOpenIcon v-if="sidebar.collapsed.value" />
            <PanelLeftCloseIcon v-else />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {{ sidebarLabel }}
          <KbdShortcut :keys="SHORTCUTS.toggleSidebar.keys" :platform="platform" />
        </TooltipContent>
      </Tooltip>
    </div>

    <button
      type="button"
      data-testid="command-palette-trigger"
      aria-haspopup="dialog"
      :aria-keyshortcuts="isMac ? 'Meta+K' : 'Control+K'"
      class="no-drag group/trigger flex h-7 w-full min-w-0 items-center gap-2 rounded-lg border border-input-border bg-background/70 pr-1 pl-2.5 text-left text-[13px] text-muted-foreground shadow-xs transition-colors outline-none hover:border-ring hover:bg-background hover:text-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring dark:bg-input/30 dark:hover:bg-input/50"
      @click="openPalette"
    >
      <SearchIcon class="size-3.5 shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate">Search connections &amp; commands…</span>
      <KbdShortcut :keys="SHORTCUTS.commandPalette.keys" :platform="platform" class="shrink-0" />
    </button>

    <div class="flex min-w-0 items-center justify-end">
      <div class="flex items-center gap-0.5 pr-2">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              data-testid="theme-toggle"
              variant="ghost"
              size="icon-sm"
              class="no-drag text-muted-foreground"
              :aria-label="themeLabel"
              @click="settings.toggleTheme()"
            >
              <SunIcon
                v-if="settings.isDark"
                class="animate-in duration-200 fade-in-0 spin-in-45 motion-reduce:animate-none"
              />
              <MoonIcon
                v-else
                class="animate-in duration-200 fade-in-0 spin-in-[-45deg] motion-reduce:animate-none"
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {{ themeLabel }}
            <KbdShortcut :keys="SHORTCUTS.toggleTheme.keys" :platform="platform" />
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              data-testid="open-settings"
              variant="ghost"
              size="icon-sm"
              class="no-drag text-muted-foreground"
              :class="nav.isSettingsOpen.value && 'bg-muted text-foreground'"
              aria-label="Settings"
              :aria-current="nav.isSettingsOpen.value ? 'page' : undefined"
              @click="nav.openSettings()"
            >
              <SettingsIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Settings
            <KbdShortcut :keys="SHORTCUTS.settings.keys" :platform="platform" />
          </TooltipContent>
        </Tooltip>
      </div>
      <!-- Native window controls (Windows / Linux overlay) draw on top of this space. -->
      <div
        aria-hidden="true"
        data-testid="window-controls-reserve"
        class="window-controls-reserve h-full shrink-0"
      />
    </div>
  </header>
</template>

<style scoped>
.window-controls-reserve {
  width: calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw));
}
</style>
