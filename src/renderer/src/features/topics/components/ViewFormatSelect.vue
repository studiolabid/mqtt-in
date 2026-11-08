<script setup lang="ts">
/**
 * Compact payload view format picker (Auto, JSON, Plaintext, Hex, Base64, MessagePack, CBOR).
 */
import type { ViewFormat } from '@shared/models'
import { VIEW_FORMATS } from '@shared/payload'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

const model = defineModel<ViewFormat>({ required: true })

function onUpdate(value: unknown): void {
  const match = VIEW_FORMATS.find((format) => format.value === value)
  if (match) model.value = match.value
}
</script>

<template>
  <Select :model-value="model" @update:model-value="onUpdate">
    <SelectTrigger
      size="sm"
      class="h-7 w-auto min-w-[5.5rem] gap-1 px-2 text-xs"
      aria-label="View payload as"
      title="View payload as"
    >
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem
        v-for="format in VIEW_FORMATS"
        :key="format.value"
        :value="format.value"
        class="text-xs"
      >
        {{ format.label }}
      </SelectItem>
    </SelectContent>
  </Select>
</template>
