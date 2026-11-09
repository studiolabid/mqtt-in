<script lang="ts">
import { ref } from 'vue'

/** Whether "Details" is open: one choice for every message, kept for the session. */
const detailsOpen = ref(false)
</script>

<script setup lang="ts">
/**
 * "Details" of the selected message, collapsed under the payload (UX-03): full date, exact
 * size, QoS, retain and DUP flags, format and mqtt-in's own sequence number as a hairline "spec
 * sheet", then the MQTT 5 properties (user properties as chips). Open or closed is remembered
 * for the session.
 *
 * "Retain flag" is the flag the broker sent: brokers clear it on messages forwarded to existing
 * subscribers unless the MQTT 5 subscription has Retain As Published.
 */
import { computed } from 'vue'
import { ChevronRightIcon } from '@lucide/vue'
import type { MqttMessage } from '@shared/models'
import { QosBadge, qosLevel, RelativeTime, TopicLabel } from '@/components/common'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { formatClock, formatDate, formatNumber } from '@/utils/format'
import { detectedFormatLabel, propertyItems, userProperties } from '../utils/message-meta'

const props = withDefaults(
  defineProps<{
    message: MqttMessage
    /** WebSocket / Socket.IO messages: no QoS, retain or DUP flags. */
    noFlags?: boolean
  }>(),
  { noFlags: false }
)

const size = computed(() => props.message.payload.length)
const properties = computed(() => propertyItems(props.message.properties))
const users = computed(() => userProperties(props.message.properties))
const format = computed(() => detectedFormatLabel(props.message.payload))

const LABEL = 'text-[10px] font-medium tracking-wider text-muted-foreground uppercase'
const CELL = 'flex min-w-0 flex-col gap-0.5 bg-background px-2.5 py-2'
</script>

<template>
  <Collapsible v-model:open="detailsOpen" data-testid="message-detail-details">
    <CollapsibleTrigger
      class="group/details -mx-1 flex h-7 items-center gap-1 rounded-md px-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      :class="LABEL"
    >
      <ChevronRightIcon
        class="size-3.5 transition-transform duration-150 group-data-open/details:rotate-90"
        aria-hidden="true"
      />
      Details
    </CollapsibleTrigger>
    <CollapsibleContent class="flex flex-col gap-4 pt-1">
      <dl
        class="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border @xs/detail:grid-cols-3"
      >
        <div :class="CELL" class="col-span-2">
          <dt :class="LABEL">{{ message.direction === 'in' ? 'Received' : 'Sent' }}</dt>
          <dd class="flex min-w-0 items-baseline gap-2 text-xs">
            <span class="truncate font-mono tabular-nums select-text"
              >{{ formatDate(message.timestamp) }} {{ formatClock(message.timestamp, true) }}</span
            >
            <RelativeTime
              :timestamp="message.timestamp"
              class="shrink-0 text-[11px] text-muted-foreground"
            />
          </dd>
        </div>
        <div :class="CELL">
          <dt :class="LABEL">Size</dt>
          <dd class="truncate font-mono text-xs tabular-nums select-text">
            {{ formatNumber(size) }} {{ size === 1 ? 'byte' : 'bytes' }}
          </dd>
        </div>
        <div v-if="!noFlags" :class="CELL">
          <dt :class="LABEL">QoS</dt>
          <dd class="flex min-w-0 items-center gap-1.5 text-xs">
            <QosBadge :qos="message.qos" />
            <span class="truncate text-muted-foreground">{{ qosLevel(message.qos).label }}</span>
          </dd>
        </div>
        <div v-if="!noFlags" :class="CELL">
          <dt :class="LABEL">Retain flag</dt>
          <dd
            class="text-xs"
            :class="message.retain ? 'font-medium text-info' : 'text-muted-foreground'"
          >
            {{ message.retain ? 'Set' : 'Not set' }}
          </dd>
        </div>
        <div v-if="!noFlags" :class="CELL">
          <dt :class="LABEL">Duplicate</dt>
          <dd
            class="text-xs"
            :class="message.dup ? 'font-medium text-warning' : 'text-muted-foreground'"
          >
            {{ message.dup ? 'Yes' : 'No' }}
          </dd>
        </div>
        <div :class="CELL">
          <dt :class="LABEL">Format</dt>
          <dd class="truncate text-xs">{{ format }}</dd>
        </div>
        <div :class="CELL">
          <dt :class="LABEL" title="mqtt-in's own sequence number, not an MQTT packet identifier">
            Seq (mqtt-in)
          </dt>
          <dd class="truncate font-mono text-xs text-muted-foreground tabular-nums select-text">
            #{{ message.id }}
          </dd>
        </div>
      </dl>

      <section v-if="properties.length > 0 || users.length > 0" class="flex flex-col gap-2">
        <h3 :class="LABEL">MQTT 5 properties</h3>
        <dl
          v-if="properties.length > 0"
          class="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs"
        >
          <template v-for="item in properties" :key="item.label">
            <dt class="text-muted-foreground">{{ item.label }}</dt>
            <dd class="min-w-0">
              <TopicLabel v-if="item.kind === 'topic'" :topic="item.value" :truncate="false" />
              <span
                v-else
                class="wrap-anywhere select-text"
                :class="item.kind === 'mono' && 'font-mono'"
                >{{ item.value }}</span
              >
            </dd>
          </template>
        </dl>
        <div v-if="users.length > 0" class="flex flex-col gap-1.5">
          <span class="text-xs text-muted-foreground">User properties</span>
          <ul class="flex flex-wrap gap-1">
            <li
              v-for="(prop, index) in users"
              :key="index"
              class="inline-flex max-w-full min-w-0 items-baseline gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] select-text"
            >
              <span class="max-w-40 truncate text-muted-foreground" :title="prop.key">{{
                prop.key
              }}</span>
              <span class="text-muted-foreground">=</span>
              <span class="min-w-0 truncate" :title="prop.value">{{ prop.value }}</span>
            </li>
          </ul>
        </div>
      </section>
    </CollapsibleContent>
  </Collapsible>
</template>
