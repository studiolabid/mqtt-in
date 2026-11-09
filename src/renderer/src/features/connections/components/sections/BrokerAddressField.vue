<script setup lang="ts">
/**
 * The broker address as one URL-like bar: `protocol:// host : port /path` (path for ws / wss).
 * Pasting a full URL into the host field (`mqtts://user:pass@host:8883`) splits it into every
 * field, credentials included; a URL typed by hand is split when leaving the field.
 * WebSocket and Socket.IO connections offer ws / wss only and call it the server.
 */
import { computed, useId } from 'vue'
import { toast } from 'vue-sonner'
import type { MqttProtocol } from '@shared/models'
import { connectionKind, KIND_DEFAULT_PATHS, protocolsOf } from '@shared/connection-kind'
import { isWebSocketProtocol } from '@shared/defaults'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { InputGroup } from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useConnectionForm } from '../../composables/useConnectionForm'
import NumberInput from '../fields/NumberInput.vue'
import TextInput from '../fields/TextInput.vue'

const PROTOCOLS: ReadonlyArray<{ value: MqttProtocol; hint: string }> = [
  { value: 'mqtt', hint: 'TCP' },
  { value: 'mqtts', hint: 'TCP + TLS' },
  { value: 'ws', hint: 'WebSocket' },
  { value: 'wss', hint: 'WebSocket + TLS' }
]

/** Text that looks like a URL or `host:port` (worth splitting on blur). */
const URL_LIKE = /:\/\/|^[^:]+:\d+$|^\[.*\]:\d+$/

const { draft, errors, setProtocol, applyBrokerUrl } = useConnectionForm()
const hostId = useId()

const kind = computed(() => connectionKind(draft.value))
const protocols = computed(() =>
  PROTOCOLS.filter((protocol) => protocolsOf(kind.value).includes(protocol.value))
)
const webSocket = computed(() => isWebSocketProtocol(draft.value.protocol))
const example = computed(() =>
  kind.value === 'mqtt'
    ? 'mqtts://user:pass@host:8883'
    : kind.value === 'socketio'
      ? 'https://api.example.com'
      : 'wss://host/path?token=…'
)
const problems = computed(() => [errors.value.host, errors.value.port].filter(Boolean))

function onProtocol(value: unknown): void {
  const match = protocols.value.find((protocol) => protocol.value === value)
  if (match) setProtocol(match.value)
}

function onPort(value: number | undefined): void {
  draft.value.port = value ?? Number.NaN
}

/** Applies a broker URL; credentials land in another section, so they are announced. */
function split(text: string): boolean {
  const parsed = applyBrokerUrl(text)
  if (!parsed) return false
  const credentials = [
    parsed.username !== undefined ? 'username' : '',
    parsed.password !== undefined ? 'password' : ''
  ].filter(Boolean)
  if (credentials.length > 0 && kind.value === 'mqtt') {
    toast.success(`Filled the ${credentials.join(' and ')} from the URL`, {
      description: 'You can review them under Authentication.'
    })
  }
  return true
}

function onPaste(event: ClipboardEvent): void {
  const text = event.clipboardData?.getData('text/plain') ?? ''
  if (split(text)) event.preventDefault()
}

function onBlur(): void {
  const host = draft.value.host.trim()
  if (URL_LIKE.test(host)) split(host)
}
</script>

<template>
  <Field :data-invalid="problems.length > 0 || undefined">
    <FieldLabel :for="hostId">{{ kind === 'mqtt' ? 'Broker' : 'Server' }}</FieldLabel>
    <InputGroup>
      <Select :model-value="draft.protocol" @update:model-value="onProtocol">
        <!-- data-slot lets the group draw its focus ring for the protocol segment too. -->
        <SelectTrigger
          data-testid="connection-protocol"
          data-slot="input-group-control"
          aria-label="Protocol"
          class="w-[6.75rem] shrink-0 rounded-none rounded-l-[inherit] border-0 border-r border-input-border bg-transparent pr-2 pl-2.5 font-mono shadow-none hover:bg-muted/60 focus-visible:ring-0 data-[size=default]:h-full dark:bg-transparent dark:hover:bg-input/40"
        >
          <SelectValue>{{ draft.protocol }}://</SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="start" class="min-w-44">
          <SelectItem v-for="protocol in protocols" :key="protocol.value" :value="protocol.value">
            <span class="font-mono">{{ protocol.value }}://</span>
            <span class="text-xs text-muted-foreground">{{ protocol.hint }}</span>
          </SelectItem>
        </SelectContent>
      </Select>
      <TextInput
        :id="hostId"
        v-model="draft.host"
        bare
        data-testid="connection-host"
        placeholder="broker.example.com"
        maxlength="1024"
        :aria-invalid="errors.host ? true : undefined"
        class="min-w-0 pr-1 font-mono"
        @paste="onPaste"
        @blur="onBlur"
      />
      <span aria-hidden="true" class="font-mono text-sm text-muted-foreground select-none">:</span>
      <NumberInput
        :model-value="draft.port"
        bare
        data-testid="connection-port"
        aria-label="Port"
        placeholder="1883"
        :min="1"
        :max="65535"
        :aria-invalid="errors.port ? true : undefined"
        class="w-[4.25rem] flex-none pr-2.5 pl-1"
        @update:model-value="onPort"
      />
      <TextInput
        v-if="webSocket"
        v-model="draft.path"
        bare
        aria-label="WebSocket path"
        data-testid="connection-path"
        :placeholder="KIND_DEFAULT_PATHS[kind]"
        class="w-24 flex-none border-l border-input-border font-mono"
      />
    </InputGroup>
    <FieldError v-if="problems.length > 0" :errors="problems" class="text-xs" />
    <FieldDescription v-else class="text-xs">
      Paste a full URL such as
      <code class="font-mono text-[11px] text-foreground/80">{{ example }}</code>
      into the host field to fill everything at once.
    </FieldDescription>
  </Field>
</template>
