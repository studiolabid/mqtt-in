<script setup lang="ts">
/**
 * MQTT 5 PUBLISH properties of the draft (the panel only shows it for MQTT 5 connections).
 * The trigger carries a dot while any property is set. Mod+Enter inside publishes.
 *
 * While connected, the topic alias field states the broker's range from its CONNACK (MQTT-03);
 * strings the broker would refuse (over 65,535 UTF-8 bytes) are flagged inline (SEC-03). The
 * fields stay editable: publishing refuses such values with the same message.
 *
 * `open` and `reference` let the publisher open it from its "More" menu (narrow header), placed
 * against that menu's button while this trigger is folded away.
 */
import { computed, useId } from 'vue'
import { SlidersHorizontalIcon } from '@lucide/vue'
import type { PublishProperties, UserProperty } from '@shared/models'
import { validateTopicName } from '@shared/topic'
import { HintTooltip, KeyValueEditor } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger
} from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { usePublishStore, useSessionsStore } from '@/stores'
import { isPublishShortcut } from '../utils/keys'
import {
  countPublishProperties,
  MAX_UINT16,
  MAX_UINT32,
  publishPropertyProblems,
  topicAliasHint
} from '../utils/properties'
import PropertyNumberInput from './PropertyNumberInput.vue'

const props = defineProps<{
  connectionId: string
  /** Position against this element instead of the trigger (the trigger is folded away). */
  reference?: HTMLElement | null
}>()
const emit = defineEmits<{ publish: [] }>()
const open = defineModel<boolean>('open', { default: false })

const publish = usePublishStore()
const sessions = useSessionsStore()

const properties = computed(() => publish.draft(props.connectionId).properties)
const count = computed(() => countPublishProperties(properties.value))
const problems = computed(() => publishPropertyProblems(properties.value))
const responseTopicError = computed(() => {
  const topic = properties.value.responseTopic
  if (!topic) return null
  return problems.value.responseTopic ?? validateTopicName(topic)
})
const broker = computed(() => sessions.brokerInfo(props.connectionId))
const aliasHint = computed(() => topicAliasHint(broker.value))
const aliasPlaceholder = computed(() => {
  const max = broker.value?.topicAliasMaximum
  return max !== undefined && max > 0 ? `1–${max}` : '1–65535'
})
const tooltip = computed(() =>
  count.value > 0 ? `MQTT 5 properties · ${count.value} set` : 'MQTT 5 properties'
)

const ids = {
  contentType: useId(),
  responseTopic: useId(),
  correlationData: useId(),
  expiry: useId(),
  alias: useId(),
  aliasHint: useId(),
  indicator: useId(),
  userError: useId()
}

type TextKey = 'contentType' | 'responseTopic' | 'correlationData'
type NumberKey = 'messageExpiryInterval' | 'topicAlias'

/** The string properties, each with its inline problem (if any). */
const textFields = computed(() => [
  {
    key: 'contentType' as const,
    label: 'Content type',
    placeholder: 'application/json',
    error: problems.value.contentType ?? null
  },
  {
    key: 'responseTopic' as const,
    label: 'Response topic',
    placeholder: 'replies/my-client',
    error: responseTopicError.value
  },
  {
    key: 'correlationData' as const,
    label: 'Correlation data',
    placeholder: 'request-42',
    error: problems.value.correlationData ?? null
  }
])

function setText(key: TextKey, value: string | number): void {
  const text = String(value)
  if (text === '') delete properties.value[key]
  else properties.value[key] = text
}

function setNumber(key: NumberKey, value: number | undefined): void {
  if (value === undefined) delete properties.value[key]
  else properties.value[key] = value
}

function setIndicator(value: boolean): void {
  if (value) properties.value.payloadFormatIndicator = true
  else delete properties.value.payloadFormatIndicator
}

function setUserProperties(list: UserProperty[]): void {
  properties.value.userProperties = list
}

function clearAll(): void {
  const empty: PublishProperties = { userProperties: [] }
  publish.updateDraft(props.connectionId, { properties: empty })
}

/** Start in the first field (not on "Clear"). */
function onOpenAutoFocus(event: Event): void {
  const input = document.getElementById(ids.contentType)
  if (!input) return
  event.preventDefault()
  input.focus()
}

function onKeydown(event: KeyboardEvent): void {
  // Enter in the user property rows is handled by KeyValueEditor (next field / new row).
  if (event.defaultPrevented || !isPublishShortcut(event)) return
  event.preventDefault()
  emit('publish')
}
</script>

<template>
  <Popover v-model:open="open">
    <HintTooltip :label="tooltip">
      <PopoverTrigger as-child>
        <Button
          data-testid="publish-properties"
          variant="ghost"
          size="icon-sm"
          class="relative"
          aria-label="MQTT 5 properties"
        >
          <SlidersHorizontalIcon aria-hidden="true" />
          <span
            v-if="count > 0"
            class="absolute top-1 right-1 size-1.5 rounded-full bg-primary ring-2 ring-background animate-in zoom-in-0 duration-150"
            aria-hidden="true"
          />
        </Button>
      </PopoverTrigger>
    </HintTooltip>
    <PopoverContent
      align="end"
      :side-offset="6"
      :reference="reference ?? undefined"
      class="scrollbar-slim max-h-(--reka-popover-content-available-height) w-84 gap-3 overflow-y-auto p-3"
      @open-auto-focus="onOpenAutoFocus"
      @keydown="onKeydown"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 flex-col gap-0.5">
          <PopoverTitle class="text-sm">MQTT 5 properties</PopoverTitle>
          <PopoverDescription class="text-xs">
            Sent with every publish and repeat on this connection.
          </PopoverDescription>
        </div>
        <Button
          v-if="count > 0"
          variant="ghost"
          size="xs"
          class="-mt-0.5 -mr-1 shrink-0 text-muted-foreground"
          @click="clearAll"
        >
          Clear
        </Button>
      </div>

      <div class="grid grid-cols-2 gap-x-2 gap-y-2.5">
        <div v-for="field in textFields" :key="field.key" class="col-span-2 grid gap-1">
          <Label :for="ids[field.key]" class="text-xs">{{ field.label }}</Label>
          <Input
            :id="ids[field.key]"
            :model-value="properties[field.key] ?? ''"
            :placeholder="field.placeholder"
            autocomplete="off"
            spellcheck="false"
            :aria-invalid="field.error ? true : undefined"
            :aria-describedby="field.error ? `${ids[field.key]}-error` : undefined"
            class="h-7 px-2 font-mono text-xs md:text-xs"
            @update:model-value="(value) => setText(field.key, value)"
          />
          <p
            v-if="field.error"
            :id="`${ids[field.key]}-error`"
            class="text-[11px] text-destructive"
            role="alert"
          >
            {{ field.error }}
          </p>
        </div>

        <div class="grid gap-1">
          <Label :for="ids.expiry" class="text-xs">Message expiry (s)</Label>
          <PropertyNumberInput
            :id="ids.expiry"
            :model-value="properties.messageExpiryInterval"
            :min="0"
            :max="MAX_UINT32"
            placeholder="never"
            @update:model-value="(value) => setNumber('messageExpiryInterval', value)"
          />
        </div>
        <div class="grid gap-1">
          <Label :for="ids.alias" class="text-xs">Topic alias</Label>
          <PropertyNumberInput
            :id="ids.alias"
            :model-value="properties.topicAlias"
            :min="1"
            :max="MAX_UINT16"
            :placeholder="aliasPlaceholder"
            :aria-describedby="aliasHint ? ids.aliasHint : undefined"
            @update:model-value="(value) => setNumber('topicAlias', value)"
          />
        </div>
        <p
          v-if="aliasHint"
          :id="ids.aliasHint"
          data-testid="publish-alias-hint"
          class="col-span-2 -mt-1 text-[11px] text-muted-foreground"
        >
          {{ aliasHint }}
        </p>

        <div
          class="col-span-2 flex items-center justify-between gap-3 rounded-lg border px-2.5 py-2"
        >
          <div class="flex min-w-0 flex-col gap-0.5">
            <Label :for="ids.indicator" class="text-xs">UTF-8 payload</Label>
            <span class="text-[11px] text-muted-foreground">Payload format indicator = 1</span>
          </div>
          <Switch
            :id="ids.indicator"
            size="sm"
            :model-value="properties.payloadFormatIndicator === true"
            @update:model-value="setIndicator"
          />
        </div>

        <div class="col-span-2 grid gap-1.5">
          <span class="text-xs font-medium">User properties</span>
          <KeyValueEditor
            :model-value="properties.userProperties ?? []"
            add-label="Add user property"
            @update:model-value="setUserProperties"
          />
          <p
            v-if="problems.userProperties"
            :id="ids.userError"
            class="text-[11px] text-destructive"
            role="alert"
          >
            {{ problems.userProperties }}
          </p>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
