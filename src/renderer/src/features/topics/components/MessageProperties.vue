<script setup lang="ts">
/**
 * MQTT 5 publish properties of a message as a compact key / value list (renders nothing when
 * the message has none).
 */
import { computed } from 'vue'
import type { MessageProperties } from '@shared/models'

const props = defineProps<{ properties?: MessageProperties }>()

interface Entry {
  label: string
  value: string
}

const entries = computed<Entry[]>(() => {
  const p = props.properties
  if (!p) return []
  const out: Entry[] = []
  if (p.contentType) out.push({ label: 'Content type', value: p.contentType })
  if (p.payloadFormatIndicator !== undefined) {
    out.push({ label: 'Payload format', value: p.payloadFormatIndicator ? 'UTF-8 text' : 'Bytes' })
  }
  if (p.responseTopic) out.push({ label: 'Response topic', value: p.responseTopic })
  if (p.correlationData) out.push({ label: 'Correlation data', value: p.correlationData })
  if (p.messageExpiryInterval !== undefined) {
    out.push({ label: 'Message expiry', value: `${p.messageExpiryInterval} s` })
  }
  if (p.topicAlias !== undefined) out.push({ label: 'Topic alias', value: String(p.topicAlias) })
  if (p.subscriptionIdentifier?.length) {
    out.push({ label: 'Subscription id', value: p.subscriptionIdentifier.join(', ') })
  }
  return out
})

const userProperties = computed(() => props.properties?.userProperties ?? [])
</script>

<template>
  <section
    v-if="entries.length > 0 || userProperties.length > 0"
    aria-label="MQTT 5 properties"
    class="rounded-lg border bg-muted/30 px-3 py-2 text-xs"
  >
    <dl
      v-if="entries.length > 0"
      class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1"
    >
      <template v-for="entry in entries" :key="entry.label">
        <dt class="text-muted-foreground">{{ entry.label }}</dt>
        <dd class="font-mono break-all select-text">{{ entry.value }}</dd>
      </template>
    </dl>
    <template v-if="userProperties.length > 0">
      <p :class="['font-medium text-muted-foreground', entries.length > 0 && 'mt-2']">
        User properties
      </p>
      <dl class="mt-1 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1">
        <template v-for="(property, index) in userProperties" :key="index">
          <dt class="font-mono break-all text-muted-foreground select-text">{{ property.key }}</dt>
          <dd class="font-mono break-all select-text">{{ property.value }}</dd>
        </template>
      </dl>
    </template>
  </section>
</template>
