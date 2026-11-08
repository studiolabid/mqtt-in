<script setup lang="ts">
/**
 * MQTT 5 subscription options in a collapsible section: No Local, Retain As Published, Retain
 * Handling and the Subscription Identifier. The header counts the options that are set.
 */
import { computed, nextTick, ref } from 'vue'
import { ChevronRightIcon } from '@lucide/vue'
import type { RetainHandling } from '@shared/models'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { RETAIN_HANDLING_OPTIONS, toRetainHandling } from '../utils/form'

defineProps<{
  /** The filter is a shared subscription (No Local is not allowed there). */
  shared: boolean
  identifierError: string | null
}>()

const open = defineModel<boolean>('open', { default: false })
const noLocal = defineModel<boolean>('noLocal', { required: true })
const retainAsPublished = defineModel<boolean>('retainAsPublished', { required: true })
const retainHandling = defineModel<RetainHandling>('retainHandling', { required: true })
const identifier = defineModel<string>('identifier', { required: true })

const identifierInput = ref<{ $el?: unknown } | null>(null)

const setCount = computed(
  () =>
    [
      noLocal.value,
      retainAsPublished.value,
      retainHandling.value !== 0,
      !!identifier.value.trim()
    ].filter(Boolean).length
)
const handlingValue = computed({
  get: () => String(retainHandling.value),
  set: (next: unknown) => {
    const value = toRetainHandling(next)
    if (value !== null) retainHandling.value = value
  }
})
const handlingLabel = computed(
  () => RETAIN_HANDLING_OPTIONS.find((option) => option.value === retainHandling.value)?.label
)

/** Opens the section and focuses the identifier field (after a refused submit). */
async function focusIdentifier(): Promise<void> {
  open.value = true
  await nextTick()
  const el = identifierInput.value?.$el
  if (el instanceof HTMLInputElement) {
    el.focus()
    el.select()
  }
}

defineExpose({ focusIdentifier })
</script>

<template>
  <Collapsible v-model:open="open" class="rounded-lg border">
    <CollapsibleTrigger
      class="group/options flex h-9 w-full items-center gap-1.5 rounded-lg px-3 text-sm font-medium outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-open:rounded-b-none"
    >
      <ChevronRightIcon
        class="size-4 text-muted-foreground transition-transform duration-150 group-data-open/options:rotate-90"
        aria-hidden="true"
      />
      MQTT 5 options
      <Badge
        v-if="setCount > 0"
        variant="secondary"
        class="ml-auto h-[18px] px-1.5 font-mono text-[11px] tabular-nums"
      >
        {{ setCount }} set
      </Badge>
    </CollapsibleTrigger>
    <CollapsibleContent
      class="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down"
    >
      <FieldGroup class="gap-4 border-t px-3 py-3">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="subscription-no-local">No Local</FieldLabel>
            <FieldDescription class="text-xs">
              Don't receive messages this connection publishes.
              <span v-if="shared && noLocal" class="text-warning">
                Ignored for shared subscriptions.
              </span>
            </FieldDescription>
          </FieldContent>
          <Switch id="subscription-no-local" v-model="noLocal" />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="subscription-rap">Retain As Published</FieldLabel>
            <FieldDescription class="text-xs">
              Keep the publisher's retain flag (useful for bridges).
            </FieldDescription>
          </FieldContent>
          <Switch id="subscription-rap" v-model="retainAsPublished" />
        </Field>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel for="subscription-retain-handling">Retain Handling</FieldLabel>
            <FieldDescription class="text-xs">
              When the broker sends retained messages.
            </FieldDescription>
          </FieldContent>
          <Select v-model="handlingValue">
            <SelectTrigger id="subscription-retain-handling" class="w-48 shrink-0">
              <SelectValue>
                <span class="font-mono text-muted-foreground tabular-nums">{{
                  retainHandling
                }}</span>
                <span class="truncate">{{ handlingLabel }}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="option in RETAIN_HANDLING_OPTIONS"
                :key="option.value"
                :value="String(option.value)"
                class="py-1.5"
              >
                <div class="flex flex-col gap-0.5">
                  <span>
                    <span class="font-mono tabular-nums">{{ option.value }}</span>
                    <span class="text-muted-foreground" aria-hidden="true"> · </span>
                    {{ option.label }}
                  </span>
                  <span class="text-xs text-muted-foreground">{{ option.description }}</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field orientation="horizontal" :data-invalid="identifierError ? true : undefined">
          <FieldContent>
            <FieldLabel for="subscription-identifier">Subscription identifier</FieldLabel>
            <FieldDescription class="text-xs">
              Tags matching messages with this number.
            </FieldDescription>
            <FieldError v-if="identifierError" class="text-xs">{{ identifierError }}</FieldError>
          </FieldContent>
          <Input
            id="subscription-identifier"
            ref="identifierInput"
            v-model="identifier"
            inputmode="numeric"
            autocomplete="off"
            spellcheck="false"
            placeholder="None"
            :aria-invalid="identifierError ? true : undefined"
            class="w-48 shrink-0 font-mono tabular-nums"
          />
        </Field>
      </FieldGroup>
    </CollapsibleContent>
  </Collapsible>
</template>
