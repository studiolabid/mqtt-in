<script setup lang="ts">
/** MQTT 5 CONNECT properties. Empty numeric fields are not sent (protocol defaults apply). */
import { computed, useId } from 'vue'
import { LayersIcon } from '@lucide/vue'
import { KeyValueEditor } from '@/components/common'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle
} from '@/components/ui/field'
import { protocolLabel } from '@/utils/connection'
import { useConnectionForm } from '../../composables/useConnectionForm'
import { describeSessionExpiry } from '../../utils/duration'
import { UINT16_MAX, UINT32_MAX } from '../../utils/validate'
import NumberInput from '../fields/NumberInput.vue'
import SectionHeader from '../fields/SectionHeader.vue'
import SectionNotice from '../fields/SectionNotice.vue'
import SwitchCard from '../fields/SwitchCard.vue'

const SESSION_PRESETS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '0', value: 0 },
  { label: '1 h', value: 3_600 },
  { label: '1 day', value: 86_400 },
  { label: 'Never', value: UINT32_MAX }
]

const { draft, errors, setVersion } = useConnectionForm()
const ids = {
  session: useId(),
  sessionPresets: useId(),
  receive: useId(),
  packet: useId(),
  alias: useId()
}

const v5 = computed(() => draft.value.protocolVersion === 5)
const properties = computed(() => draft.value.properties)
const sessionHint = computed(() => describeSessionExpiry(properties.value.sessionExpiryInterval))

function setSessionExpiry(value: number | undefined): void {
  properties.value.sessionExpiryInterval = value
}

function setReceiveMaximum(value: number | undefined): void {
  properties.value.receiveMaximum = value
}

function setMaximumPacketSize(value: number | undefined): void {
  properties.value.maximumPacketSize = value
}

function setTopicAliasMaximum(value: number | undefined): void {
  properties.value.topicAliasMaximum = value
}

function setResponseInformation(value: boolean): void {
  properties.value.requestResponseInformation = value
}

function setProblemInformation(value: boolean): void {
  properties.value.requestProblemInformation = value
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <SectionHeader section="mqtt5" />
    <SectionNotice
      v-if="!v5"
      :icon="LayersIcon"
      :title="`This connection uses ${protocolLabel(draft.protocolVersion)}`"
      description="These properties are kept, but only sent to MQTT 5.0 brokers."
      action-label="Switch to MQTT 5.0"
      @action="setVersion(5)"
    />
    <FieldGroup class="gap-5">
      <Field :data-invalid="errors.sessionExpiryInterval ? true : undefined">
        <FieldLabel :for="ids.session">Session expiry interval</FieldLabel>
        <div class="flex flex-wrap items-center gap-2">
          <NumberInput
            :id="ids.session"
            :model-value="properties.sessionExpiryInterval"
            unit="s"
            placeholder="0"
            :max="UINT32_MAX"
            :aria-invalid="errors.sessionExpiryInterval ? true : undefined"
            class="w-44"
            @update:model-value="setSessionExpiry"
          />
          <div role="group" aria-label="Session expiry presets" class="flex items-center gap-1">
            <Button
              v-for="preset in SESSION_PRESETS"
              :key="preset.value"
              type="button"
              size="xs"
              variant="ghost"
              :aria-pressed="properties.sessionExpiryInterval === preset.value"
              class="text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
              @click="setSessionExpiry(preset.value)"
            >
              {{ preset.label }}
            </Button>
          </div>
        </div>
        <FieldError v-if="errors.sessionExpiryInterval" class="text-xs">
          {{ errors.sessionExpiryInterval }}
        </FieldError>
        <FieldDescription v-else class="text-xs">{{ sessionHint }}</FieldDescription>
      </Field>

      <div class="grid gap-4 sm:grid-cols-3">
        <Field :data-invalid="errors.receiveMaximum ? true : undefined">
          <FieldLabel :for="ids.receive">Receive maximum</FieldLabel>
          <NumberInput
            :id="ids.receive"
            :model-value="properties.receiveMaximum"
            placeholder="65535"
            :min="1"
            :max="UINT16_MAX"
            :aria-invalid="errors.receiveMaximum ? true : undefined"
            @update:model-value="setReceiveMaximum"
          />
        </Field>
        <Field :data-invalid="errors.maximumPacketSize ? true : undefined">
          <FieldLabel :for="ids.packet">Maximum packet size</FieldLabel>
          <NumberInput
            :id="ids.packet"
            :model-value="properties.maximumPacketSize"
            unit="B"
            placeholder="No limit"
            :min="1"
            :max="UINT32_MAX"
            :aria-invalid="errors.maximumPacketSize ? true : undefined"
            @update:model-value="setMaximumPacketSize"
          />
        </Field>
        <Field :data-invalid="errors.topicAliasMaximum ? true : undefined">
          <FieldLabel :for="ids.alias">Topic alias maximum</FieldLabel>
          <NumberInput
            :id="ids.alias"
            :model-value="properties.topicAliasMaximum"
            placeholder="0"
            :max="UINT16_MAX"
            :aria-invalid="errors.topicAliasMaximum ? true : undefined"
            @update:model-value="setTopicAliasMaximum"
          />
        </Field>
        <FieldError
          v-if="errors.receiveMaximum || errors.maximumPacketSize || errors.topicAliasMaximum"
          class="-mt-2 text-xs sm:col-span-3"
          :errors="[
            errors.receiveMaximum && `Receive maximum: ${errors.receiveMaximum}`,
            errors.maximumPacketSize && `Maximum packet size: ${errors.maximumPacketSize}`,
            errors.topicAliasMaximum && `Topic alias maximum: ${errors.topicAliasMaximum}`
          ]"
        />
        <FieldDescription v-else class="-mt-2 text-xs sm:col-span-3">
          Leave empty to use the protocol defaults shown as placeholders.
        </FieldDescription>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <SwitchCard
          :model-value="properties.requestResponseInformation ?? false"
          title="Request response information"
          description="Ask the broker for response information (request / response)."
          @update:model-value="setResponseInformation"
        />
        <SwitchCard
          :model-value="properties.requestProblemInformation ?? true"
          title="Request problem information"
          description="Let the broker send reason strings and properties on failures."
          @update:model-value="setProblemInformation"
        />
      </div>

      <Field>
        <FieldTitle>User properties</FieldTitle>
        <KeyValueEditor v-model="properties.userProperties" />
        <FieldError v-if="errors.userProperties" class="text-xs">
          {{ errors.userProperties }}
        </FieldError>
      </Field>
    </FieldGroup>
  </div>
</template>
