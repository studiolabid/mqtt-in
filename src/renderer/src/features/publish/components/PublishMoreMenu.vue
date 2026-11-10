<script setup lang="ts">
/**
 * "More" menu of the publisher header (A11Y-07): the panel shows it only while it is too narrow
 * for every header control (200 % zoom, a narrow column). Container queries in `PublishPanel`
 * fold the payload format, MQTT 5 properties, history, saved messages and an idle repeat into it
 * below 28rem, and QoS and retain below 20rem; like the message toolbar's "More" menu, it always
 * offers every option.
 *
 * Properties, history, saved messages and repeat open their popover or dialog only once this menu
 * has closed (`open`), so its focus return does not dismiss them; the panel anchors them to this
 * button.
 * While folded away, retain on and a running repeat put a dot on the button.
 */
import { computed } from 'vue'
import {
  BookmarkIcon,
  BracesIcon,
  EllipsisIcon,
  HistoryIcon,
  RepeatIcon,
  SlidersHorizontalIcon,
  SquareIcon
} from '@lucide/vue'
import type { PayloadFormat } from '@shared/models'
import { PAYLOAD_FORMATS } from '@shared/payload'
import { HintTooltip, QOS_LEVELS, toQos } from '@/components/common'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { usePublishStore } from '@/stores'
import type { PublishMoreAction } from '../composables/useFoldedControls'
import { FORMAT_META } from '../utils/payload-tools'
import { repeatLabel } from '../utils/repeat'

const props = defineProps<{
  connectionId: string
  /** MQTT 5 connection: offers the PUBLISH properties. */
  mqtt5: boolean
  /** MQTT connection: offers QoS and retain (WebSocket / Socket.IO have neither). */
  mqtt: boolean
}>()

const emit = defineEmits<{
  open: [action: PublishMoreAction]
  /** A payload format was picked (the panel offers to convert the payload). */
  pickFormat: [format: PayloadFormat]
}>()

const publish = usePublishStore()
const draft = computed(() => publish.draft(props.connectionId))
const job = computed(() => publish.activeJobFor(props.connectionId))

const FORMAT_GROUPS = [
  { label: 'Text', formats: PAYLOAD_FORMATS.filter((format) => !format.binary) },
  { label: 'Binary', formats: PAYLOAD_FORMATS.filter((format) => format.binary) }
]

/** States that are hidden from the header at the narrowest width (the dot and the name). */
const flags = computed(() => [
  ...(props.mqtt && draft.value.retain ? ['retain on'] : []),
  ...(job.value ? ['repeating'] : [])
])
const label = computed(() =>
  flags.value.length > 0
    ? `More publish options (${flags.value.join(', ')})`
    : 'More publish options'
)

/** The action to run once the menu has closed. */
let queued: PublishMoreAction | null = null

function queue(action: PublishMoreAction): void {
  queued = action
}

function setQos(value: unknown): void {
  const qos = toQos(value)
  if (qos !== null) draft.value.qos = qos
}

function setRetain(value: boolean | 'indeterminate'): void {
  draft.value.retain = value === true
}

function setFormat(value: unknown): void {
  const next = PAYLOAD_FORMATS.find((format) => format.value === value)
  if (next) emit('pickFormat', next.value)
}

function stopRepeat(): void {
  const current = job.value
  if (current) void publish.stopRepeat(current.jobId)
}

/** Runs the queued action after the menu closed, instead of returning focus to the trigger. */
function onCloseAutoFocus(event: Event): void {
  const action = queued
  queued = null
  if (action === null) return
  event.preventDefault()
  emit('open', action)
}
</script>

<template>
  <DropdownMenu>
    <HintTooltip label="More publish options">
      <DropdownMenuTrigger as-child>
        <Button
          data-testid="publish-more"
          variant="ghost"
          size="icon-sm"
          :aria-label="label"
          class="relative text-muted-foreground hover:text-foreground"
        >
          <EllipsisIcon aria-hidden="true" />
          <span
            v-if="flags.length > 0"
            :class="[
              'absolute top-1 right-1 size-1.5 rounded-full ring-2 ring-background @xs/publish:hidden',
              job ? 'bg-outgoing' : 'bg-primary'
            ]"
            aria-hidden="true"
          />
        </Button>
      </DropdownMenuTrigger>
    </HintTooltip>
    <DropdownMenuContent
      data-testid="publish-more-menu"
      align="end"
      class="w-64"
      @close-auto-focus="onCloseAutoFocus"
    >
      <DropdownMenuLabel>Publish options</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        v-if="mqtt"
        :model-value="String(draft.qos)"
        @update:model-value="setQos"
      >
        <DropdownMenuRadioItem
          v-for="level in QOS_LEVELS"
          :key="level.value"
          :value="String(level.value)"
          :data-testid="`publish-more-qos-${level.value}`"
        >
          <span class="font-mono tabular-nums">QoS {{ level.value }}</span>
          <span class="ml-auto pl-2 text-xs text-muted-foreground">{{ level.label }}</span>
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuCheckboxItem
        v-if="mqtt"
        data-testid="publish-more-retain"
        :model-value="draft.retain"
        @update:model-value="setRetain"
      >
        Retain
        <span class="ml-auto pl-2 text-xs text-muted-foreground">kept on the broker</span>
      </DropdownMenuCheckboxItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger data-testid="publish-more-format">
          <BracesIcon />
          Payload format
          <span class="ml-auto pl-2 text-xs text-muted-foreground">
            {{ FORMAT_META[draft.format].short }}
          </span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent class="w-56">
          <DropdownMenuRadioGroup :model-value="draft.format" @update:model-value="setFormat">
            <template v-for="(group, index) in FORMAT_GROUPS" :key="group.label">
              <DropdownMenuSeparator v-if="index > 0" />
              <DropdownMenuLabel class="text-[11px]">{{ group.label }}</DropdownMenuLabel>
              <DropdownMenuRadioItem
                v-for="format in group.formats"
                :key="format.value"
                :value="format.value"
              >
                {{ format.label }}
              </DropdownMenuRadioItem>
            </template>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        v-if="mqtt5"
        data-testid="publish-more-properties"
        @select="queue('properties')"
      >
        <SlidersHorizontalIcon />
        MQTT 5 properties…
      </DropdownMenuItem>
      <DropdownMenuItem data-testid="publish-more-history" @select="queue('history')">
        <HistoryIcon />
        History…
      </DropdownMenuItem>
      <DropdownMenuItem data-testid="publish-more-saved" @select="queue('saved')">
        <BookmarkIcon />
        Saved messages…
      </DropdownMenuItem>
      <DropdownMenuItem data-testid="publish-more-repeat" @select="queue('repeat')">
        <RepeatIcon />
        <span v-if="job" class="min-w-0 truncate">{{ repeatLabel(job) }}</span>
        <template v-else>Repeat publishing…</template>
      </DropdownMenuItem>
      <DropdownMenuItem v-if="job" data-testid="publish-more-repeat-stop" @select="stopRepeat">
        <SquareIcon class="fill-current" />
        Stop repeating
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
