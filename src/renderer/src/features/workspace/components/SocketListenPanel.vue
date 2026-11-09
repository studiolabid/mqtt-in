<script setup lang="ts">
/**
 * The left column of a WebSocket or Socket.IO workspace, where MQTT connections list their
 * subscriptions: these connections receive everything the server sends, so it says what is
 * received and with which options (namespace, topic field, subprotocols, headers).
 */
import { computed } from 'vue'
import { RadioIcon } from '@lucide/vue'
import {
  connectionKind,
  normalizeNamespace,
  parseSubprotocols,
  socketSettings,
  WS_MESSAGE_TOPIC
} from '@shared/connection-kind'
import type { ConnectionProfile } from '@shared/models'
import { PanelHeader } from '@/components/common'

const props = defineProps<{ profile: ConnectionProfile }>()

const kind = computed(() => connectionKind(props.profile))
const socket = computed(() => socketSettings(props.profile))

const rows = computed(() => {
  const settings = socket.value
  const list: Array<{ label: string; value: string }> = []
  if (kind.value === 'socketio') {
    list.push({ label: 'Namespace', value: normalizeNamespace(settings.namespace) })
    list.push({ label: 'Auth', value: settings.auth.trim() === '' ? 'None' : 'Sent' })
  } else {
    list.push({
      label: 'Topic',
      value:
        settings.topicField.trim() === ''
          ? WS_MESSAGE_TOPIC
          : `JSON field "${settings.topicField.trim()}"`
    })
    const subprotocols = parseSubprotocols(settings.subprotocols)
    list.push({
      label: 'Subprotocols',
      value: subprotocols.length > 0 ? subprotocols.join(', ') : 'None'
    })
  }
  const headers = settings.headers.filter((header) => header.key.trim() !== '')
  list.push({
    label: 'Headers',
    value: headers.length > 0 ? headers.map((header) => header.key.trim()).join(', ') : 'None'
  })
  return list
})
</script>

<template>
  <section
    data-testid="socket-listen-panel"
    aria-label="Listening"
    class="flex h-full min-h-0 flex-col bg-panel"
  >
    <PanelHeader title="Listening" :icon="RadioIcon" />
    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 text-xs">
      <p class="text-pretty text-muted-foreground">
        <template v-if="kind === 'socketio'">
          Every event the server emits arrives as a message on its event name. Subscriptions are
          only for MQTT connections.
        </template>
        <template v-else>
          Every message the server sends arrives here. Subscriptions are only for MQTT connections.
        </template>
      </p>
      <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <template v-for="row in rows" :key="row.label">
          <dt class="text-muted-foreground">{{ row.label }}</dt>
          <dd class="font-mono wrap-anywhere text-foreground select-text">{{ row.value }}</dd>
        </template>
      </dl>
    </div>
  </section>
</template>
