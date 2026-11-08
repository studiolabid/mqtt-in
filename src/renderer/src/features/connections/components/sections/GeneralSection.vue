<script setup lang="ts">
/**
 * General: name, group, color, broker address, MQTT version and client id. With clean start off
 * and no client id, the hint says that one is generated when saving (MQTT-07).
 */
import { computed, useId } from 'vue'
import { RefreshCwIcon } from '@lucide/vue'
import { PROTOCOL_VERSIONS } from '@shared/defaults'
import { ColorSwatchPicker } from '@/components/common'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldTitle
} from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton } from '@/components/ui/input-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useConnectionForm } from '../../composables/useConnectionForm'
import GroupInput from '../fields/GroupInput.vue'
import SectionHeader from '../fields/SectionHeader.vue'
import TextInput from '../fields/TextInput.vue'
import { persistentSessionHint } from '../../utils/validate'
import BrokerAddressField from './BrokerAddressField.vue'

const { draft, errors, groupSuggestions, setVersion, regenerateClientId } = useConnectionForm()
const ids = { name: useId(), group: useId(), version: useId(), clientId: useId() }

const versionValue = computed(() => String(draft.value.protocolVersion))
/** MQTT 3.1 limits client ids to 23 characters (many brokers enforce it). */
const longClientId = computed(
  () => draft.value.protocolVersion === 3 && draft.value.clientId.trim().length > 23
)
const sessionHint = computed(() => persistentSessionHint(draft.value))

function onVersion(value: unknown): void {
  // A single toggle group can be emptied by clicking the active item: keep the version.
  const version = Number(value)
  if (version === 3 || version === 4 || version === 5) setVersion(version)
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <SectionHeader section="general" />
    <FieldGroup class="gap-5">
      <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,13rem)]">
        <Field :data-invalid="errors.name ? true : undefined">
          <FieldLabel :for="ids.name">Name</FieldLabel>
          <TextInput
            :id="ids.name"
            v-model="draft.name"
            data-testid="connection-name"
            data-autofocus
            placeholder="My broker"
            maxlength="256"
            :aria-invalid="errors.name ? true : undefined"
          />
          <FieldError v-if="errors.name" class="text-xs">{{ errors.name }}</FieldError>
        </Field>
        <Field>
          <FieldLabel :for="ids.group">Group</FieldLabel>
          <GroupInput :id="ids.group" v-model="draft.group" :suggestions="groupSuggestions" />
        </Field>
      </div>

      <Field>
        <FieldTitle>Color</FieldTitle>
        <ColorSwatchPicker v-model="draft.color" label="Connection color" />
      </Field>

      <FieldSeparator />

      <BrokerAddressField />

      <div class="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
        <Field>
          <FieldTitle :id="ids.version">MQTT version</FieldTitle>
          <div>
            <ToggleGroup
              type="single"
              :model-value="versionValue"
              :spacing="1"
              :aria-labelledby="ids.version"
              class="h-8 rounded-lg bg-muted p-[3px]"
              @update:model-value="onVersion"
            >
              <ToggleGroupItem
                v-for="version in PROTOCOL_VERSIONS"
                :key="version.value"
                :value="String(version.value)"
                :aria-label="version.label"
                :data-testid="`connection-version-${version.value}`"
                class="h-full min-w-0 rounded-md border border-transparent px-3 font-mono text-xs text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-xs data-[state=on]:bg-background dark:aria-pressed:border-input dark:aria-pressed:bg-input/50 dark:data-[state=on]:bg-input/50"
              >
                {{ version.label.replace('MQTT ', '') }}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </Field>
        <Field :data-invalid="errors.clientId ? true : undefined">
          <FieldLabel :for="ids.clientId">Client ID</FieldLabel>
          <InputGroup>
            <TextInput
              :id="ids.clientId"
              v-model="draft.clientId"
              bare
              :placeholder="
                sessionHint ? 'Generated when you save' : 'Auto-generated on each connect'
              "
              :aria-invalid="errors.clientId ? true : undefined"
              class="font-mono"
            />
            <InputGroupAddon align="inline-end">
              <Tooltip>
                <TooltipTrigger as-child>
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="Generate a client ID"
                    @click="regenerateClientId"
                  >
                    <RefreshCwIcon aria-hidden="true" />
                  </InputGroupButton>
                </TooltipTrigger>
                <TooltipContent>Generate a new client ID</TooltipContent>
              </Tooltip>
            </InputGroupAddon>
          </InputGroup>
          <FieldError v-if="errors.clientId" class="text-xs">{{ errors.clientId }}</FieldError>
          <FieldDescription v-else-if="longClientId" class="text-xs text-warning">
            MQTT 3.1 brokers may reject client IDs longer than 23 characters.
          </FieldDescription>
          <FieldDescription v-else-if="sessionHint" data-testid="client-id-hint" class="text-xs">
            {{ sessionHint }}
          </FieldDescription>
          <FieldDescription v-else class="text-xs">
            Leave empty to auto-generate one on each connect.
          </FieldDescription>
        </Field>
      </div>
    </FieldGroup>
  </div>
</template>
