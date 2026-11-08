<script setup lang="ts">
/**
 * The five most recently used connections (live status, broker URL, last connect).
 */
import { computed } from 'vue'
import { ChevronRightIcon } from '@lucide/vue'
import { brokerUrl } from '@shared/defaults'
import { ConnectionAvatar, RelativeTime } from '@/components/common'
import { useNavigation } from '@/composables'
import { useConnectionsStore, useSessionsStore } from '@/stores'
import { isActiveStatus, statusLabel } from '@/utils/connection'
import { recentProfiles } from '../../utils/recent'

const connections = useConnectionsStore()
const sessions = useSessionsStore()
const nav = useNavigation()

const recent = computed(() =>
  recentProfiles(connections.profiles).map((profile) => ({
    profile,
    url: brokerUrl(profile),
    status: sessions.statusOf(profile.id)
  }))
)
</script>

<template>
  <section aria-labelledby="welcome-recent" class="min-w-0">
    <h2 id="welcome-recent" class="mb-2.5 text-xs font-medium text-muted-foreground">Recent</h2>
    <ul class="overflow-hidden rounded-xl border bg-card dark:bg-card/70">
      <li v-for="item in recent" :key="item.profile.id" class="border-b last:border-b-0">
        <button
          type="button"
          class="group/row flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left transition-colors outline-none hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          @click="nav.openConnection(item.profile.id)"
        >
          <ConnectionAvatar
            :name="item.profile.name"
            :color="item.profile.color"
            :status="item.status"
            size="sm"
            class="[--avatar-surface:var(--card)]"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium" :title="item.profile.name">
              {{ item.profile.name }}
            </span>
            <span
              class="block truncate font-mono text-[11px] text-muted-foreground"
              :title="item.url"
            >
              {{ item.url }}
            </span>
          </span>
          <span class="shrink-0 text-xs text-muted-foreground">
            <span
              v-if="isActiveStatus(item.status) || item.status === 'error'"
              :class="
                item.status === 'connected'
                  ? 'text-success'
                  : item.status === 'error'
                    ? 'text-destructive'
                    : undefined
              "
            >
              {{ statusLabel(item.status) }}
            </span>
            <RelativeTime
              v-else-if="item.profile.lastConnectedAt"
              :timestamp="item.profile.lastConnectedAt"
            />
            <span v-else>Never connected</span>
          </span>
          <ChevronRightIcon
            class="-mr-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
            aria-hidden="true"
          />
        </button>
      </li>
    </ul>
  </section>
</template>
