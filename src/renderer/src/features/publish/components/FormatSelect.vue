<script setup lang="ts">
/**
 * Payload format picker: a short label in the trigger, text and binary formats grouped with a
 * one-line explanation each. Attributes (e.g. `data-testid`) go to the trigger button.
 */
import type { PayloadFormat } from '@shared/models'
import { PAYLOAD_FORMATS } from '@shared/payload'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { FORMAT_META } from '../utils/payload-tools'

defineOptions({ inheritAttrs: false })

const model = defineModel<PayloadFormat>({ required: true })

const GROUPS = [
  { label: 'Text', formats: PAYLOAD_FORMATS.filter((format) => !format.binary) },
  { label: 'Binary', formats: PAYLOAD_FORMATS.filter((format) => format.binary) }
]

function onUpdate(value: unknown): void {
  const next = PAYLOAD_FORMATS.find((format) => format.value === value)
  if (next) model.value = next.value
}
</script>

<template>
  <Select :model-value="model" @update:model-value="onUpdate">
    <SelectTrigger
      v-bind="$attrs"
      size="sm"
      aria-label="Payload format"
      class="gap-1 pr-1.5 pl-2 text-xs"
    >
      <SelectValue>{{ FORMAT_META[model].short }}</SelectValue>
    </SelectTrigger>
    <SelectContent position="popper" align="end" :side-offset="6" class="min-w-60">
      <template v-for="(group, index) in GROUPS" :key="group.label">
        <SelectSeparator v-if="index > 0" />
        <SelectGroup>
          <SelectLabel class="text-[11px]">{{ group.label }}</SelectLabel>
          <SelectItem
            v-for="format in group.formats"
            :key="format.value"
            :value="format.value"
            class="py-1.5"
          >
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="text-[13px] leading-tight">{{ format.label }}</span>
              <span class="text-xs leading-tight text-muted-foreground">
                {{ FORMAT_META[format.value].hint }}
              </span>
            </span>
          </SelectItem>
        </SelectGroup>
      </template>
    </SelectContent>
  </Select>
</template>
