<script setup lang="ts">
/**
 * Socket (WebSocket and Socket.IO connections): handshake headers for both; subprotocols and
 * the topic field for WebSocket; namespace and auth payload for Socket.IO. The topic field
 * groups JSON messages in the topic tree by one of their values.
 */
import { computed, useId } from 'vue'
import { InfoIcon } from '@lucide/vue'
import { connectionKind, WS_MESSAGE_TOPIC } from '@shared/connection-kind'
import { KeyValueEditor } from '@/components/common'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle
} from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { useConnectionForm } from '../../composables/useConnectionForm'
import SectionHeader from '../fields/SectionHeader.vue'
import TextInput from '../fields/TextInput.vue'

const { draft, errors } = useConnectionForm()
const ids = { subprotocols: useId(), topicField: useId(), namespace: useId(), auth: useId() }

const kind = computed(() => connectionKind(draft.value))
const socket = computed(() => draft.value.socket)
</script>

<template>
  <div class="flex flex-col gap-6">
    <SectionHeader section="socket" />
    <FieldGroup v-if="socket" class="gap-5">
      <p
        class="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
      >
        <InfoIcon class="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span v-if="kind === 'socketio'">
          Every event the server emits shows up as a message on its event name. Publishing emits the
          topic as the event, with the payload as JSON (or text). Socket.IO servers 3 and 4 are
          supported.
        </span>
        <span v-else>
          Every message the server sends shows up as a message. Publishing sends the payload as a
          text frame (binary when it is not UTF-8 text); the topic is only a label.
        </span>
      </p>

      <template v-if="kind === 'websocket'">
        <Field :data-invalid="errors.subprotocols ? true : undefined">
          <FieldLabel :for="ids.subprotocols">Subprotocols</FieldLabel>
          <TextInput
            :id="ids.subprotocols"
            v-model="socket.subprotocols"
            data-testid="connection-subprotocols"
            placeholder="e.g. json, graphql-transport-ws"
            :aria-invalid="errors.subprotocols ? true : undefined"
            class="font-mono"
          />
          <FieldError v-if="errors.subprotocols" class="text-xs">
            {{ errors.subprotocols }}
          </FieldError>
          <FieldDescription v-else class="text-xs">
            Comma separated, sent as Sec-WebSocket-Protocol. Leave empty for none.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel :for="ids.topicField">Topic field</FieldLabel>
          <TextInput
            :id="ids.topicField"
            v-model="socket.topicField"
            data-testid="connection-topic-field"
            placeholder="e.g. type"
            class="font-mono"
          />
          <FieldDescription class="text-xs">
            JSON messages are grouped in the topic tree by this field's value (e.g.
            <code class="font-mono">type</code>, <code class="font-mono">event</code>). Other
            messages go to <code class="font-mono">{{ WS_MESSAGE_TOPIC }}</code
            >.
          </FieldDescription>
        </Field>
      </template>

      <template v-else>
        <Field>
          <FieldLabel :for="ids.namespace">Namespace</FieldLabel>
          <TextInput
            :id="ids.namespace"
            v-model="socket.namespace"
            data-testid="connection-namespace"
            placeholder="/"
            class="font-mono"
          />
          <FieldDescription class="text-xs">
            For example <code class="font-mono">/admin</code>. The path of the server (usually
            <code class="font-mono">/socket.io/</code>) is part of the address.
          </FieldDescription>
        </Field>
        <Field :data-invalid="errors.socketAuth ? true : undefined">
          <FieldLabel :for="ids.auth">Auth</FieldLabel>
          <Textarea
            :id="ids.auth"
            v-model="socket.auth"
            data-testid="connection-socket-auth"
            placeholder='{"token": "…"}'
            spellcheck="false"
            rows="3"
            :aria-invalid="errors.socketAuth ? true : undefined"
            class="min-h-16 font-mono text-xs"
          />
          <FieldError v-if="errors.socketAuth" class="text-xs">{{ errors.socketAuth }}</FieldError>
          <FieldDescription v-else class="text-xs">
            A JSON object the server reads as <code class="font-mono">socket.handshake.auth</code>.
            Leave empty for none.
          </FieldDescription>
        </Field>
      </template>

      <Field :data-invalid="errors.socketHeaders ? true : undefined">
        <FieldTitle>Headers</FieldTitle>
        <KeyValueEditor
          v-model="socket.headers"
          key-placeholder="Header"
          value-placeholder="Value"
          add-label="Add header"
        />
        <FieldError v-if="errors.socketHeaders" class="text-xs">
          {{ errors.socketHeaders }}
        </FieldError>
        <FieldDescription v-else class="text-xs">
          Sent with the opening handshake, e.g.
          <code class="font-mono">Authorization: Bearer …</code>.
        </FieldDescription>
      </Field>
    </FieldGroup>
  </div>
</template>
