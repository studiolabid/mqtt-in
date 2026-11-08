<script setup lang="ts">
/** MQTT 5 will properties (part of the Last Will section). Empty fields are not sent. */
import { computed, useId } from 'vue'
import { KeyValueEditor } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Field, FieldDescription, FieldError, FieldLabel, FieldTitle } from '@/components/ui/field'
import { useConnectionForm } from '../../composables/useConnectionForm'
import { UINT32_MAX } from '../../utils/validate'
import NumberInput from '../fields/NumberInput.vue'
import SwitchCard from '../fields/SwitchCard.vue'
import TextInput from '../fields/TextInput.vue'

const { draft, errors } = useConnectionForm()
const ids = {
  delay: useId(),
  expiry: useId(),
  contentType: useId(),
  responseTopic: useId(),
  correlation: useId()
}

const v5 = computed(() => draft.value.protocolVersion === 5)
const properties = computed(() => draft.value.will.properties)

function setDelay(value: number | undefined): void {
  properties.value.willDelayInterval = value
}

function setExpiry(value: number | undefined): void {
  properties.value.messageExpiryInterval = value
}

function setUtf8(value: boolean): void {
  properties.value.payloadFormatIndicator = value
}
</script>

<template>
  <section
    aria-label="Will properties"
    class="flex flex-col gap-4 rounded-lg border bg-muted/20 p-3.5"
  >
    <div class="flex items-center gap-2">
      <h4 class="text-sm font-medium">Will properties</h4>
      <Badge variant="secondary" class="font-mono">MQTT 5</Badge>
      <span v-if="!v5" class="text-xs text-muted-foreground">Only sent to MQTT 5.0 brokers</span>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <Field :data-invalid="errors.willDelayInterval ? true : undefined">
        <FieldLabel :for="ids.delay">Will delay</FieldLabel>
        <NumberInput
          :id="ids.delay"
          :model-value="properties.willDelayInterval"
          unit="s"
          placeholder="0"
          :max="UINT32_MAX"
          :aria-invalid="errors.willDelayInterval ? true : undefined"
          @update:model-value="setDelay"
        />
        <FieldError v-if="errors.willDelayInterval" class="text-xs">
          {{ errors.willDelayInterval }}
        </FieldError>
        <FieldDescription v-else class="text-xs">Reconnecting in time cancels it.</FieldDescription>
      </Field>
      <Field :data-invalid="errors.willMessageExpiryInterval ? true : undefined">
        <FieldLabel :for="ids.expiry">Message expiry</FieldLabel>
        <NumberInput
          :id="ids.expiry"
          :model-value="properties.messageExpiryInterval"
          unit="s"
          placeholder="Never"
          :max="UINT32_MAX"
          :aria-invalid="errors.willMessageExpiryInterval ? true : undefined"
          @update:model-value="setExpiry"
        />
        <FieldError v-if="errors.willMessageExpiryInterval" class="text-xs">
          {{ errors.willMessageExpiryInterval }}
        </FieldError>
      </Field>
      <Field :data-invalid="errors.willContentType ? true : undefined">
        <FieldLabel :for="ids.contentType">Content type</FieldLabel>
        <TextInput
          :id="ids.contentType"
          v-model="properties.contentType"
          placeholder="application/json"
          :aria-invalid="errors.willContentType ? true : undefined"
          class="font-mono"
        />
        <FieldError v-if="errors.willContentType" class="text-xs">
          {{ errors.willContentType }}
        </FieldError>
      </Field>
      <Field :data-invalid="errors.willResponseTopic ? true : undefined">
        <FieldLabel :for="ids.responseTopic">Response topic</FieldLabel>
        <TextInput
          :id="ids.responseTopic"
          v-model="properties.responseTopic"
          placeholder="None"
          :aria-invalid="errors.willResponseTopic ? true : undefined"
          class="font-mono"
        />
        <FieldError v-if="errors.willResponseTopic" class="text-xs">
          {{ errors.willResponseTopic }}
        </FieldError>
      </Field>
      <Field class="sm:col-span-2" :data-invalid="errors.willCorrelationData ? true : undefined">
        <FieldLabel :for="ids.correlation">Correlation data</FieldLabel>
        <TextInput
          :id="ids.correlation"
          v-model="properties.correlationData"
          placeholder="None"
          :aria-invalid="errors.willCorrelationData ? true : undefined"
          class="font-mono"
        />
        <FieldError v-if="errors.willCorrelationData" class="text-xs">
          {{ errors.willCorrelationData }}
        </FieldError>
      </Field>
    </div>

    <SwitchCard
      :model-value="properties.payloadFormatIndicator ?? false"
      title="UTF-8 payload"
      description="Sets the payload format indicator: the payload is UTF-8 encoded text."
      @update:model-value="setUtf8"
    />

    <Field :data-invalid="errors.willUserProperties ? true : undefined">
      <FieldTitle>User properties</FieldTitle>
      <KeyValueEditor v-model="properties.userProperties" />
      <FieldError v-if="errors.willUserProperties" class="text-xs">
        {{ errors.willUserProperties }}
      </FieldError>
    </Field>
  </section>
</template>
