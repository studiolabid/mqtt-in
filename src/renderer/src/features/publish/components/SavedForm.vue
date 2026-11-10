<script setup lang="ts">
/**
 * "Save current" in the saved messages popover: a name (typed later in the payload to load the
 * message) and whether the draft's topic is kept. A taken name replaces that message, which the
 * form says before saving. Retain is never saved.
 */
import { computed, nextTick, onMounted, ref, useId } from 'vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useSavedMessagesStore } from '@/stores'
import type { PublishDraft } from '@/types'
import { savedNameProblem } from '@/utils/saved-messages'

const props = defineProps<{ draft: PublishDraft }>()

const emit = defineEmits<{ saved: [name: string]; cancel: [] }>()

const saved = useSavedMessagesStore()
const ids = { name: useId(), topic: useId(), hint: useId() }
const name = ref('')
const keepTopic = ref(true)
const error = ref<string | null>(null)
const input = ref<InstanceType<typeof Input> | null>(null)

const replaces = computed(() => saved.byName(name.value))
const hint = computed(() => {
  if (error.value) return error.value
  if (replaces.value) return `Replaces the saved “${replaces.value.name}”.`
  return 'Type this name in the payload and press Tab to load the message.'
})

onMounted(() => {
  void nextTick(() => {
    const element: unknown = input.value?.$el
    if (element instanceof HTMLInputElement) element.focus()
  })
})

function submit(): void {
  const result = saved.save(props.draft, name.value, { keepTopic: keepTopic.value })
  if (!result.ok) {
    error.value = result.error
    return
  }
  emit('saved', result.saved.name)
}

function setKeepTopic(value: boolean | 'indeterminate'): void {
  keepTopic.value = value === true
}

function onNameInput(value: string | number): void {
  name.value = String(value)
  error.value = savedNameProblem(name.value) === null ? null : error.value
}
</script>

<template>
  <form class="flex flex-col gap-3 p-3" data-testid="publish-saved-form" @submit.prevent="submit">
    <div class="flex flex-col gap-1.5">
      <label :for="ids.name" class="text-xs font-medium">Name</label>
      <Input
        :id="ids.name"
        ref="input"
        :model-value="name"
        data-testid="publish-saved-name"
        placeholder="e.g. status"
        autocomplete="off"
        spellcheck="false"
        :maxlength="40"
        :aria-invalid="error ? true : undefined"
        :aria-describedby="ids.hint"
        class="h-8 font-mono text-xs"
        @update:model-value="onNameInput"
        @keydown.esc.stop.prevent="emit('cancel')"
      />
      <p
        :id="ids.hint"
        :class="['text-[11px] leading-snug', error ? 'text-destructive' : 'text-muted-foreground']"
      >
        {{ hint }}
      </p>
    </div>
    <div class="flex min-w-0 items-center gap-2">
      <Checkbox
        :id="ids.topic"
        :model-value="keepTopic"
        data-testid="publish-saved-keep-topic"
        @update:model-value="setKeepTopic"
      />
      <label :for="ids.topic" class="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <span class="shrink-0">Include topic</span>
        <span class="truncate font-mono text-foreground">{{ draft.topic || '—' }}</span>
      </label>
    </div>
    <p v-if="!keepTopic" class="-mt-1.5 text-[11px] leading-snug text-muted-foreground">
      Loading it keeps the topic already in the draft.
    </p>
    <div class="flex justify-end gap-1.5">
      <Button type="button" variant="ghost" size="sm" @click="emit('cancel')">Cancel</Button>
      <Button type="submit" size="sm" data-testid="publish-saved-save">
        {{ replaces ? 'Replace' : 'Save' }}
      </Button>
    </div>
  </form>
</template>
