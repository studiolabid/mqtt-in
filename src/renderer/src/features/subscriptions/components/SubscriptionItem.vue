<script setup lang="ts">
/**
 * One subscription row: status glyph in the subscription color, alias and filter, matching
 * message count, QoS (the granted QoS as a warning when the broker downgraded it) and the
 * enable switch. Click toggles the message filter; right-click opens the row menu.
 *
 * - The hover actions (Edit, Delete) fade in at the trailing edge, over the count and QoS (no
 *   reflow), so the rest of the row stays one click target (UX-16). Secondary details drop out
 *   first in narrow lists (container queries on the `list` container); the count stays visible
 *   at the default panel width (UX-06).
 * - The row that filters the message list is marked independently of the subscription color
 *   (stronger background, an inset ring, medium weight), clearly apart from hover (UX-08).
 * - Screen readers get the status details (failure reason, granted QoS, options) through
 *   `aria-describedby`; the status tooltip opens while the keyboard cursor is on the row (A11Y-20).
 */
import { computed, ref } from 'vue'
import { PencilIcon, Trash2Icon, TriangleAlertIcon } from '@lucide/vue'
import type { ConnectionProfile, Subscription, SubscriptionEvent } from '@shared/models'
import { QosBadge, TopicLabel } from '@/components/common'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useFormatters } from '@/composables'
import { cn } from '@/lib/utils'
import {
  filterPrefix,
  glyphTitle,
  grantedQos,
  isDowngraded,
  statusDetails,
  subscriptionDomId,
  subscriptionGlyph
} from '../utils/subscription-view'
import SubscriptionRowMenu from './SubscriptionRowMenu.vue'
import SubscriptionStatus from './SubscriptionStatus.vue'

const props = defineProps<{
  subscription: Subscription
  /** Profile of the connection (row menu: copy as command). */
  profile: ConnectionProfile | undefined
  /** Live state (undefined = not subscribed in this session). */
  live?: SubscriptionEvent
  connected: boolean
  /** The connection speaks MQTT 5 (options are listed in the status tooltip). */
  mqtt5: boolean
  /** The message list is filtered by this subscription. */
  filtered: boolean
  /** Keyboard cursor of the focused list. */
  active: boolean
  /** Messages received matching the filter (0 hides the counter). */
  count: number
}>()

const emit = defineEmits<{
  toggleFilter: []
  edit: []
  duplicate: []
  remove: []
  copy: []
  showTopic: []
  setEnabled: [enabled: boolean]
}>()

const fmt = useFormatters()
const menuOpen = ref(false)

const alias = computed(() => props.subscription.alias.trim())
const state = computed(() => props.live?.state ?? 'idle')
const glyph = computed(() => subscriptionGlyph(props.subscription.enabled, props.live))
const title = computed(() => glyphTitle(glyph.value, props.connected))
const details = computed(() => {
  const lines = statusDetails(props.subscription, props.live, props.mqtt5)
  if (props.count > 0) lines.push(`${fmt.number(props.count)} messages received`)
  return lines
})
const granted = computed(() => grantedQos(props.live))
const downgraded = computed(() => isDowngraded(props.subscription.qos, props.live))
const canShowTopic = computed(() => filterPrefix(props.subscription.topic) !== '')
const ariaLabel = computed(() => `${alias.value || props.subscription.topic}, ${title.value}`)
const detailsId = computed(() => `${subscriptionDomId(props.subscription.id)}-details`)

// Row colors are opaque (mixed with the panel) so the hover actions can fade over the text. The
// tints come from the foreground (`--accent` is almost the panel color in light), so the filtered
// row never depends on the subscription color and stays clearly stronger than hover.
const ROW =
  'group/item relative flex min-h-8 cursor-default items-center gap-2 rounded-md py-1.5 pr-2 pl-2.5 transition-colors duration-150 hover:bg-(--row-hover)'
const NEUTRAL =
  '[--row-hover:color-mix(in_srgb,var(--foreground)_4%,var(--panel))] dark:[--row-hover:color-mix(in_srgb,var(--foreground)_6%,var(--panel))]'
const FILTERED =
  'font-medium ring-1 ring-foreground/25 ring-inset [--row-hover:color-mix(in_srgb,var(--foreground)_13%,var(--panel))] dark:[--row-hover:color-mix(in_srgb,var(--foreground)_17%,var(--panel))] before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-(--sub)'
const FILTERED_BG =
  'bg-[color-mix(in_srgb,var(--foreground)_10%,var(--panel))] dark:bg-[color-mix(in_srgb,var(--foreground)_13%,var(--panel))]'

const rowClass = computed(() => {
  // One resting background at a time (no reliance on class merging for arbitrary values).
  const background = menuOpen.value ? 'bg-(--row-hover)' : props.filtered ? FILTERED_BG : ''
  return cn(
    ROW,
    props.filtered ? FILTERED : NEUTRAL,
    background,
    // Inset: the next (positioned) row would paint over an outer ring.
    props.active && 'ring-2 ring-ring ring-inset'
  )
})

function onClick(event: MouseEvent): void {
  // Selecting text in the row (drag, double click) must not toggle the filter.
  const row = event.currentTarget
  const selection = window.getSelection()
  if (row instanceof Node && selection && !selection.isCollapsed) {
    if (selection.anchorNode && row.contains(selection.anchorNode)) return
  }
  emit('toggleFilter')
}
</script>

<template>
  <ContextMenu @update:open="menuOpen = $event">
    <ContextMenuTrigger as-child>
      <div
        :id="subscriptionDomId(subscription.id)"
        role="option"
        :aria-selected="filtered"
        :aria-label="ariaLabel"
        :aria-describedby="detailsId"
        data-testid="subscription-item"
        :data-subscription-id="subscription.id"
        :data-state="state"
        :data-enabled="subscription.enabled"
        :data-filtered="filtered || undefined"
        :style="{ '--sub': subscription.color }"
        :class="rowClass"
        @click="onClick"
      >
        <SubscriptionStatus
          :glyph="glyph"
          :color="subscription.color"
          :title="title"
          :details="details"
          :open="active"
        />
        <span :id="detailsId" class="sr-only">{{ details.join('. ') }}</span>

        <div class="min-w-0 flex-1 group-data-[enabled=false]/item:opacity-55">
          <template v-if="alias">
            <p class="truncate text-[13px] leading-[18px] font-medium select-text" :title="alias">
              {{ alias }}
            </p>
            <TopicLabel
              :topic="subscription.topic"
              class="text-xs leading-4 text-muted-foreground"
            />
          </template>
          <TopicLabel v-else :topic="subscription.topic" class="text-[13px] leading-5" />
        </div>

        <!-- Trailing details; the hover actions fade in over them at the row's end (dropped in
             very narrow lists, where the row menu and keys remain). -->
        <div class="relative flex shrink-0 items-center gap-2 self-stretch">
          <span
            v-if="count > 0"
            data-testid="subscription-count"
            class="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums group-data-[enabled=false]/item:opacity-55 @max-[12rem]/list:hidden"
            :title="`${fmt.number(count)} messages received`"
          >
            {{ fmt.compact(count) }}
          </span>
          <span
            v-if="downgraded"
            class="inline-flex h-4 min-w-6 shrink-0 items-center justify-center gap-0.5 rounded-[4px] border border-warning/40 bg-warning/10 px-1 font-mono text-[10px] leading-none font-medium text-warning tabular-nums @max-[11rem]/list:hidden"
            :title="`Granted QoS ${granted} (requested ${subscription.qos})`"
          >
            <TriangleAlertIcon class="size-2.5" aria-hidden="true" />
            <span aria-hidden="true">Q{{ granted }}</span>
            <span class="sr-only">Granted QoS {{ granted }}, requested {{ subscription.qos }}</span>
          </span>
          <QosBadge
            v-else
            :qos="subscription.qos"
            :tooltip="false"
            class="group-data-[enabled=false]/item:opacity-55 @max-[11rem]/list:hidden"
          />
          <div
            class="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 bg-[linear-gradient(to_right,transparent,var(--row-hover)_1.25rem)] pl-6 opacity-0 transition-opacity duration-150 group-hover/item:pointer-events-auto group-hover/item:opacity-100 @max-[10rem]/list:hidden"
          >
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  tabindex="-1"
                  aria-label="Edit subscription"
                  data-testid="subscription-edit"
                  class="text-muted-foreground hover:bg-background/60 dark:hover:bg-background/40"
                  @mousedown.prevent
                  @click.stop="emit('edit')"
                >
                  <PencilIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  tabindex="-1"
                  aria-label="Delete subscription"
                  data-testid="subscription-delete"
                  class="text-muted-foreground hover:bg-background/60 hover:text-destructive dark:hover:bg-background/40"
                  @mousedown.prevent
                  @click.stop="emit('remove')"
                >
                  <Trash2Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <Switch
          size="sm"
          tabindex="-1"
          data-testid="subscription-toggle"
          :model-value="subscription.enabled"
          :aria-label="subscription.enabled ? 'Disable subscription' : 'Enable subscription'"
          :title="subscription.enabled ? 'Enabled' : 'Disabled'"
          class="@max-[9rem]/list:hidden"
          @mousedown.prevent
          @update:model-value="(value: boolean) => emit('setEnabled', value)"
          @click.stop
        />
      </div>
    </ContextMenuTrigger>

    <SubscriptionRowMenu
      :subscription="subscription"
      :profile="profile"
      :filtered="filtered"
      :enabled="subscription.enabled"
      :can-show-topic="canShowTopic"
      @toggle-filter="emit('toggleFilter')"
      @show-topic="emit('showTopic')"
      @copy="emit('copy')"
      @edit="emit('edit')"
      @duplicate="emit('duplicate')"
      @set-enabled="(enabled: boolean) => emit('setEnabled', enabled)"
      @remove="emit('remove')"
    />
  </ContextMenu>
</template>
