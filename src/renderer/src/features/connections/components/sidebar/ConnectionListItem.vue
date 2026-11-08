<script setup lang="ts">
/**
 * One connection in the sidebar: avatar with status, name, address and a toggle shown on hover
 * (connect / disconnect; spinner while busy, which turns into "cancel" on hover). Click opens,
 * double-click toggles, right-click opens the context menu. Drag & drop and focus listeners
 * are bound by the list (they fall through to the root element).
 *
 * A neutral pill after the name counts the messages received since the connection's workspace
 * was last shown (`connection-unread`, FP-2): hidden at 0 and for the open connection, part of
 * the row's accessible name.
 */
import { computed } from 'vue'
import { CircleAlertIcon, PlugIcon, UnplugIcon, XIcon } from '@lucide/vue'
import type { ConnectionProfile } from '@shared/models'
import { brokerUrl } from '@shared/defaults'
import { ConnectionAvatar, HighlightText } from '@/components/common'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useThrottledValue } from '@/composables/useThrottledValue'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'
import { isActiveStatus, statusLabel } from '@/utils/connection'
import { useConnectionActions } from '@/composables/useConnectionActions'
import type { DropPosition } from '../../utils/order'
import { unreadLabel, unreadSpoken, unreadTitle } from '../../utils/unread-label'
import ConnectionItemMenu from './ConnectionItemMenu.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  profile: ConnectionProfile
  /** Its workspace is open. */
  active: boolean
  /** Search terms to highlight. */
  terms: readonly string[]
  /** Reachable with Tab (roving tab stop of the list). */
  tabStop: boolean
  draggable: boolean
  dragging: boolean
  dropPosition: DropPosition | null
}>()

const sessions = useSessionsStore()
const ui = useUiStore()
const actions = useConnectionActions()

/** Messages since the workspace was last shown (none for the open one), at most twice a second. */
const unread = useThrottledValue(() => (props.active ? 0 : ui.unreadCount(props.profile.id)), 500)
const unreadText = computed(() => unreadLabel(unread.value))

const session = computed(() => sessions.get(props.profile.id))
const status = computed(() => session.value.status)
const live = computed(() => isActiveStatus(status.value))
/** Connecting / reconnecting can be cancelled; disconnecting just has to finish. */
const cancellable = computed(() => status.value === 'connecting' || status.value === 'reconnecting')
const busy = computed(() => cancellable.value || status.value === 'disconnecting')
const problem = computed(() =>
  status.value === 'error' || status.value === 'reconnecting' ? session.value.error : undefined
)
const url = computed(() => brokerUrl(props.profile))
const toggleLabel = computed(() => {
  if (status.value === 'connected') return 'Disconnect'
  if (cancellable.value) return 'Cancel'
  if (status.value === 'disconnecting') return 'Disconnecting…'
  return 'Connect'
})
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <div
        v-bind="$attrs"
        role="listitem"
        data-testid="connection-item"
        :data-connection-id="profile.id"
        :data-status="status"
        :data-active="active ? 'true' : undefined"
        :draggable="draggable ? 'true' : 'false'"
        :class="
          cn(
            'group/item relative flex items-center gap-2 rounded-md py-1.5 pr-1.5 pl-2 transition-[background-color,opacity] duration-150 hover:bg-sidebar-accent/70 data-open:bg-sidebar-accent/70',
            active && 'bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent',
            dragging && 'opacity-40'
          )
        "
      >
        <span
          v-if="active"
          aria-hidden="true"
          class="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-r-full bg-primary"
        />
        <button
          type="button"
          data-nav
          :tabindex="tabStop ? 0 : -1"
          :aria-current="active ? 'page' : undefined"
          :title="`${profile.name} — ${url}`"
          class="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
          @click="actions.open(profile.id)"
          @dblclick="actions.toggle(profile.id)"
        >
          <ConnectionAvatar
            :name="profile.name"
            :color="profile.color"
            :status="status"
            class="[--avatar-surface:var(--sidebar)]"
          />
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="flex min-w-0 items-center gap-1">
              <HighlightText
                :text="profile.name"
                :terms="terms"
                class="truncate text-[13px] leading-tight font-medium"
              />
              <!-- The empty title keeps the row's native tooltip from stacking on this one. -->
              <Tooltip v-if="problem">
                <TooltipTrigger as-child>
                  <span class="inline-flex shrink-0" title="">
                    <CircleAlertIcon
                      :class="
                        cn('size-3.5', status === 'error' ? 'text-destructive' : 'text-warning')
                      "
                      aria-hidden="true"
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" class="max-w-72">{{ problem }}</TooltipContent>
              </Tooltip>
              <Tooltip v-if="unreadText">
                <TooltipTrigger as-child>
                  <span
                    data-testid="connection-unread"
                    title=""
                    aria-hidden="true"
                    class="ml-auto inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-muted px-1 font-mono text-[10px] leading-none font-medium text-foreground tabular-nums"
                  >
                    {{ unreadText }}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">{{ unreadTitle(unread) }}</TooltipContent>
              </Tooltip>
            </span>
            <span
              class="flex min-w-0 items-baseline font-mono text-[11px] leading-tight text-muted-foreground"
            >
              <span class="shrink-0">{{ profile.protocol }}://</span>
              <HighlightText :text="profile.host" :terms="terms" class="min-w-0 truncate" />
              <span class="shrink-0">:{{ profile.port }}</span>
            </span>
          </span>
          <span class="sr-only">
            {{ statusLabel(status) }}{{ problem ? `: ${problem}` : ''
            }}{{ unreadText ? `, ${unreadSpoken(unread)}` : '' }}
          </span>
        </button>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              :tabindex="tabStop ? 0 : -1"
              :aria-label="`${toggleLabel} ${profile.name}`"
              :aria-disabled="status === 'disconnecting' || undefined"
              :class="
                cn(
                  'relative z-10 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/item:opacity-100 group-has-[:focus-visible]/item:opacity-100 group-data-open/item:opacity-100 hover:bg-foreground/6 hover:text-foreground dark:hover:bg-foreground/10',
                  busy && 'opacity-100'
                )
              "
              @click.stop="actions.toggle(profile.id)"
              @dblclick.stop
            >
              <template v-if="busy">
                <Spinner :class="cn('size-3.5', cancellable && 'group-hover/button:hidden')" />
                <XIcon
                  v-if="cancellable"
                  class="hidden size-3.5 group-hover/button:block"
                  aria-hidden="true"
                />
              </template>
              <UnplugIcon v-else-if="live" class="size-3.5" aria-hidden="true" />
              <PlugIcon v-else class="size-3.5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ toggleLabel }}</TooltipContent>
        </Tooltip>
        <!-- Drop indicator, inside the row so a collapsing group never clips it. -->
        <span
          v-if="dropPosition"
          aria-hidden="true"
          :class="
            cn(
              'pointer-events-none absolute right-1 left-1 z-20 h-0.5 rounded-full bg-primary shadow-[0_0_0_1px_var(--sidebar)]',
              dropPosition === 'before' ? 'top-0' : 'bottom-0'
            )
          "
        />
      </div>
    </ContextMenuTrigger>
    <ConnectionItemMenu :profile="profile" :status="status" />
  </ContextMenu>
</template>
