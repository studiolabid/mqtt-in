<script setup lang="ts">
/**
 * Advanced: clean start / session, keep alive, connect timeout, connect on startup and auto
 * reconnect. The number fields use the limits of the main process (`LIMITS`). With clean start
 * off and no client id, a hint says that one is generated when saving (a new id on every connect
 * could never resume the session, MQTT-07).
 */
import { computed, useId } from 'vue'
import { ArrowRightIcon, InfoIcon } from '@lucide/vue'
import { LIMITS } from '@shared/defaults'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { useConnectionForm } from '../../composables/useConnectionForm'
import { persistentSessionHint } from '../../utils/validate'
import NumberInput from '../fields/NumberInput.vue'
import SectionHeader from '../fields/SectionHeader.vue'
import SwitchCard from '../fields/SwitchCard.vue'

const { draft, errors, section } = useConnectionForm()
const ids = { keepalive: useId(), timeout: useId(), period: useId() }

const v5 = computed(() => draft.value.protocolVersion === 5)
/** MQTT 5 ends a session at disconnect unless a session expiry interval is set. */
const sessionEndsAnyway = computed(
  () => v5.value && !draft.value.clean && !((draft.value.properties.sessionExpiryInterval ?? 0) > 0)
)
const sessionHint = computed(() => persistentSessionHint(draft.value))

function setKeepalive(value: number | undefined): void {
  draft.value.keepalive = value ?? Number.NaN
}

function setConnectTimeout(value: number | undefined): void {
  draft.value.connectTimeout = value ?? Number.NaN
}

function setReconnectPeriod(value: number | undefined): void {
  draft.value.reconnectPeriod = value ?? Number.NaN
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <SectionHeader section="advanced" />
    <FieldGroup class="gap-5">
      <div class="flex flex-col gap-2">
        <SwitchCard
          v-model="draft.clean"
          :title="v5 ? 'Clean start' : 'Clean session'"
          :description="
            v5
              ? 'Start a fresh session on every connect. Turn off to resume the previous one (subscriptions and queued messages).'
              : 'Discard the session on disconnect. Turn off to let the broker keep subscriptions and queue QoS 1 and 2 messages.'
          "
        />
        <p
          v-if="sessionEndsAnyway"
          class="flex items-center gap-2 px-1 text-xs text-muted-foreground animate-in fade-in-0 duration-150"
        >
          <InfoIcon class="size-3.5 shrink-0 text-info" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            Without a session expiry interval the broker still ends the session at disconnect.
          </span>
          <Button
            type="button"
            variant="link"
            size="xs"
            class="h-auto shrink-0 px-0"
            @click="section = 'mqtt5'"
          >
            Set it in MQTT 5
            <ArrowRightIcon aria-hidden="true" />
          </Button>
        </p>
        <p
          v-if="sessionHint"
          data-testid="persistent-session-hint"
          class="flex items-center gap-2 px-1 text-xs text-muted-foreground animate-in fade-in-0 duration-150"
        >
          <InfoIcon class="size-3.5 shrink-0 text-info" aria-hidden="true" />
          <span class="min-w-0 flex-1">{{ sessionHint }}</span>
        </p>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <Field :data-invalid="errors.keepalive ? true : undefined">
          <FieldLabel :for="ids.keepalive">Keep alive</FieldLabel>
          <NumberInput
            :id="ids.keepalive"
            :model-value="draft.keepalive"
            unit="s"
            placeholder="60"
            :max="LIMITS.keepaliveS.max"
            :aria-invalid="errors.keepalive ? true : undefined"
            @update:model-value="setKeepalive"
          />
          <FieldError v-if="errors.keepalive" class="text-xs">{{ errors.keepalive }}</FieldError>
          <FieldDescription v-else class="text-xs">
            Ping interval while idle. 0 turns it off.
          </FieldDescription>
        </Field>
        <Field :data-invalid="errors.connectTimeout ? true : undefined">
          <FieldLabel :for="ids.timeout">Connect timeout</FieldLabel>
          <NumberInput
            :id="ids.timeout"
            :model-value="draft.connectTimeout"
            unit="s"
            :scale="1000"
            decimals
            placeholder="10"
            :max="LIMITS.connectTimeoutMs.max"
            :aria-invalid="errors.connectTimeout ? true : undefined"
            @update:model-value="setConnectTimeout"
          />
          <FieldError v-if="errors.connectTimeout" class="text-xs">
            {{ errors.connectTimeout }}
          </FieldError>
          <FieldDescription v-else class="text-xs">
            How long to wait for the broker. 0 uses 30 s.
          </FieldDescription>
        </Field>
      </div>

      <SwitchCard
        v-model="draft.autoConnect"
        data-testid="connection-auto-connect"
        title="Connect on startup"
        description="Connect as soon as mqtt-in starts, so its subscriptions are live again after a restart."
      />
      <SwitchCard
        v-model="draft.autoReconnect"
        title="Reconnect automatically"
        description="Retry when the connection drops or an attempt fails. Refused credentials stop the retries."
      />
      <div class="grid gap-4 sm:grid-cols-2">
        <Field
          :data-invalid="errors.reconnectPeriod ? true : undefined"
          :data-disabled="draft.autoReconnect ? undefined : 'true'"
        >
          <FieldLabel :for="ids.period">Reconnect period</FieldLabel>
          <NumberInput
            :id="ids.period"
            :model-value="draft.reconnectPeriod"
            unit="s"
            :scale="1000"
            decimals
            placeholder="4"
            :min="LIMITS.reconnectPeriodMs.min"
            :max="LIMITS.reconnectPeriodMs.max"
            :disabled="!draft.autoReconnect"
            :aria-invalid="errors.reconnectPeriod ? true : undefined"
            @update:model-value="setReconnectPeriod"
          />
          <FieldError v-if="errors.reconnectPeriod" class="text-xs">
            {{ errors.reconnectPeriod }}
          </FieldError>
          <FieldDescription v-else class="text-xs">Pause between two attempts.</FieldDescription>
        </Field>
      </div>
    </FieldGroup>
  </div>
</template>
