<script setup lang="ts">
/** Last Will: topic, QoS, retain, payload and (MQTT 5) will properties. */
import { computed, useId } from 'vue'
import { CodeEditor, QosSelect } from '@/components/common'
import { Field, FieldError, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/stores/settings'
import { useConnectionForm } from '../../composables/useConnectionForm'
import SectionHeader from '../fields/SectionHeader.vue'
import SwitchCard from '../fields/SwitchCard.vue'
import TextInput from '../fields/TextInput.vue'
import WillPropertiesFields from './WillPropertiesFields.vue'

const { draft, errors, submit } = useConnectionForm()
const settings = useSettingsStore()
const ids = { topic: useId(), retain: useId(), delivery: useId() }

const language = computed(() => (/^\s*[[{]/.test(draft.value.will.payload) ? 'json' : 'text'))
</script>

<template>
  <div class="flex flex-col gap-6">
    <SectionHeader section="will" />
    <SwitchCard
      v-model="draft.will.enabled"
      data-testid="connection-will-enabled"
      title="Send a last will message"
      description="The broker publishes it when this client drops without disconnecting cleanly."
    />
    <FieldGroup v-if="draft.will.enabled" class="gap-5 animate-in fade-in-0 duration-150">
      <Field :data-invalid="errors.willTopic ? true : undefined">
        <FieldLabel :for="ids.topic">Topic</FieldLabel>
        <TextInput
          :id="ids.topic"
          v-model="draft.will.topic"
          data-testid="connection-will-topic"
          placeholder="devices/my-client/status"
          :aria-invalid="errors.willTopic ? true : undefined"
          class="font-mono"
        />
        <FieldError v-if="errors.willTopic" class="text-xs">{{ errors.willTopic }}</FieldError>
      </Field>

      <Field>
        <FieldTitle :id="ids.delivery">Delivery</FieldTitle>
        <div
          role="group"
          :aria-labelledby="ids.delivery"
          class="flex flex-wrap items-center gap-x-5 gap-y-2"
        >
          <QosSelect v-model="draft.will.qos" class="w-28" />
          <div class="flex items-center gap-2">
            <Switch :id="ids.retain" v-model="draft.will.retain" />
            <FieldLabel :for="ids.retain" class="font-normal">Retain</FieldLabel>
          </div>
        </div>
      </Field>

      <Field>
        <FieldTitle>Payload</FieldTitle>
        <div
          class="overflow-hidden rounded-lg border border-input-border transition-[color,box-shadow] has-[.cm-focused]:border-ring has-[.cm-focused]:ring-1 has-[.cm-focused]:ring-ring dark:bg-input/30"
        >
          <CodeEditor
            v-model="draft.will.payload"
            :language="language"
            :wrap="settings.settings.wordWrap"
            label="Last will payload"
            placeholder="e.g. offline"
            min-height="5.5rem"
            max-height="14rem"
            @submit="submit"
          />
        </div>
        <FieldError v-if="errors.willPayload" class="text-xs">{{ errors.willPayload }}</FieldError>
      </Field>

      <WillPropertiesFields />
    </FieldGroup>
  </div>
</template>
