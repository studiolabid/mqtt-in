<script setup lang="ts">
/**
 * Application frame: title bar, resizable / collapsible connection sidebar, the routed view
 * (remounted per route: switching connections remounts the workspace) and the status bar.
 * Registers the global shortcuts. The sidebar column is a plain container: the sidebar itself is
 * the "Connections" landmark (no nested duplicate, A11Y-23).
 */
import { RouterView } from 'vue-router'
import ConnectionSidebar from '@/features/connections/ConnectionSidebar.vue'
import SidebarResizeHandle from './components/SidebarResizeHandle.vue'
import StatusBar from './components/StatusBar.vue'
import TitleBar from './components/TitleBar.vue'
import { SIDEBAR_WIDTH, useSidebarLayout } from './composables/useSidebarLayout'
import { useShellHotkeys } from './composables/useShellHotkeys'

const sidebar = useSidebarLayout()

useShellHotkeys()
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
    <TitleBar />
    <div class="flex min-h-0 flex-1">
      <div
        v-show="!sidebar.collapsed.value"
        id="app-sidebar"
        class="flex min-h-0 shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground"
        :style="{ width: `${sidebar.width.value}px` }"
      >
        <ConnectionSidebar />
      </div>
      <SidebarResizeHandle
        v-if="!sidebar.collapsed.value"
        :width="sidebar.width.value"
        :min="SIDEBAR_WIDTH.min"
        :max="SIDEBAR_WIDTH.max"
        @resize="sidebar.previewWidth"
        @commit="sidebar.commitWidth"
        @collapse="sidebar.setCollapsed(true)"
        @reset="sidebar.resetWidth()"
      />
      <main class="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <RouterView v-slot="{ Component, route }">
          <div
            v-if="Component"
            :key="route.path"
            class="h-full min-h-0 animate-in duration-150 fade-in-0 motion-reduce:animate-none"
          >
            <component :is="Component" />
          </div>
        </RouterView>
      </main>
    </div>
    <StatusBar />
  </div>
</template>
