<script setup lang="ts">
/**
 * Editable list of key / value rows (MQTT 5 user properties). Emits a new array on every
 * change (the bound array is never mutated), keeps stable row keys so focus survives edits,
 * and supports a keyboard flow: Enter moves key → value → next row (adding one at the end).
 */
import { computed, nextTick, ref, watch } from 'vue'
import { PlusIcon, XIcon } from '@lucide/vue'
import type { UserProperty } from '@shared/models'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const props = withDefaults(
  defineProps<{
    keyPlaceholder?: string
    valuePlaceholder?: string
    addLabel?: string
    disabled?: boolean
    /** Maximum number of rows (unlimited when unset). */
    max?: number
  }>(),
  {
    keyPlaceholder: 'Key',
    valuePlaceholder: 'Value',
    addLabel: 'Add property',
    disabled: false
  }
)

const model = defineModel<UserProperty[]>({ default: () => [] })

const root = ref<HTMLElement | null>(null)

// Row identities, index-aligned with the model (not derived from the row objects: parents may
// clone the rows they receive, which must not remount the inputs and lose focus).
let sequence = 0
const ids = ref<string[]>([])

watch(
  () => (model.value ?? []).length,
  (length) => {
    if (ids.value.length === length) return
    const next = ids.value.slice(0, length)
    while (next.length < length) next.push(`kv-${++sequence}`)
    ids.value = next
  },
  { immediate: true }
)

const rows = computed(() =>
  (model.value ?? []).map((property, index) => ({
    id: ids.value[index] ?? `kv-pending-${index}`,
    property
  }))
)

const canAdd = computed(
  () => !props.disabled && (props.max === undefined || rows.value.length < props.max)
)

function focusField(index: number, field: 'key' | 'value'): void {
  void nextTick(() => {
    root.value
      ?.querySelector<HTMLInputElement>(`[data-row="${index}"] [data-field="${field}"]`)
      ?.focus()
  })
}

function update(index: number, field: keyof UserProperty, value: string | number): void {
  const text = String(value)
  model.value = (model.value ?? []).map((property, i) =>
    i === index ? { ...property, [field]: text } : property
  )
}

function add(): void {
  if (!canAdd.value) return
  const list = model.value ?? []
  model.value = [...list, { key: '', value: '' }]
  focusField(list.length, 'key')
}

function remove(index: number): void {
  const list = model.value ?? []
  // Drop the row's identity first so the following rows keep theirs (and their DOM).
  ids.value = ids.value.filter((_, i) => i !== index)
  model.value = list.filter((_, i) => i !== index)
  const next = Math.min(index, list.length - 2)
  if (next >= 0) focusField(next, 'key')
  else void nextTick(() => root.value?.querySelector<HTMLButtonElement>('[data-add]')?.focus())
}

function onEnter(index: number, field: 'key' | 'value'): void {
  if (field === 'key') return focusField(index, 'value')
  if (index < rows.value.length - 1) return focusField(index + 1, 'key')
  add()
}
</script>

<template>
  <div ref="root" data-slot="key-value-editor" class="flex flex-col gap-1.5">
    <div
      v-for="(row, index) in rows"
      :key="row.id"
      :data-row="index"
      class="flex items-center gap-1.5 animate-in fade-in-0 duration-150"
    >
      <Input
        data-field="key"
        :model-value="row.property.key"
        :placeholder="keyPlaceholder"
        :aria-label="`${keyPlaceholder} ${index + 1}`"
        :disabled="disabled"
        autocomplete="off"
        spellcheck="false"
        class="h-7 min-w-0 flex-1 px-2 font-mono text-xs md:text-xs"
        @update:model-value="(value) => update(index, 'key', value)"
        @keydown.enter.prevent="onEnter(index, 'key')"
      />
      <Input
        data-field="value"
        :model-value="row.property.value"
        :placeholder="valuePlaceholder"
        :aria-label="`${valuePlaceholder} ${index + 1}`"
        :disabled="disabled"
        autocomplete="off"
        spellcheck="false"
        class="h-7 min-w-0 flex-[1.4] px-2 font-mono text-xs md:text-xs"
        @update:model-value="(value) => update(index, 'value', value)"
        @keydown.enter.prevent="onEnter(index, 'value')"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        :disabled="disabled"
        :aria-label="`Remove ${row.property.key || `row ${index + 1}`}`"
        @click="remove(index)"
      >
        <XIcon class="size-3.5" aria-hidden="true" />
      </Button>
    </div>
    <div>
      <Button
        type="button"
        data-add
        variant="ghost"
        size="xs"
        class="-ml-1 text-muted-foreground hover:text-foreground"
        :disabled="!canAdd"
        :title="canAdd || disabled ? undefined : `Limit of ${max} reached`"
        @click="add"
      >
        <PlusIcon aria-hidden="true" />
        {{ addLabel }}
      </Button>
    </div>
  </div>
</template>
