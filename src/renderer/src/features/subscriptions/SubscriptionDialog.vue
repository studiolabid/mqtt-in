<script setup lang="ts">
/**
 * Create / edit subscription dialog (singleton in App.vue, driven by
 * `useUiStore().subscriptionDialog`). Create mode can add several filters at once (all in the
 * chosen color, or each in its own with "Give each a distinct color"). Store errors are shown
 * inline and keep the dialog open; Mod+Enter saves from any field.
 */
import { computed, nextTick, ref, useId } from 'vue'
import { CircleAlertIcon, InfoIcon } from '@lucide/vue'
import { isSharedSubscription } from '@shared/topic'
import { ColorSwatchPicker, KbdShortcut, QosSelect } from '@/components/common'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { hostPlatform } from '@/composables'
import { useUiStore } from '@/stores'
import { matchesHotkey, parseHotkey } from '@/utils/hotkey'
import { SHORTCUTS } from '@/utils/shortcuts'
import Mqtt5Options from './components/Mqtt5Options.vue'
import TopicFilterField from './components/TopicFilterField.vue'
import { useFilterPreview } from './composables/useFilterPreview'
import { useSubscriptionForm } from './composables/useSubscriptionForm'

/** Dialog-local submit keys (handled on the dialog element, not as a window shortcut). */
const SUBMIT_KEYS = SHORTCUTS.submitDialog.keys
const SUBMIT_HOTKEY = parseHotkey(SHORTCUTS.submitDialog.combo)

const ui = useUiStore()
const dialog = ui.subscriptionDialog
const platform = hostPlatform()
const {
  form,
  distinctColors,
  profile,
  editing,
  missing,
  mqtt5,
  connected,
  saving,
  saveError,
  optionsOpen,
  topicError,
  linesError,
  identifierError,
  parsed,
  previewFilter,
  saveLabel,
  footerNote,
  invalidField,
  submit
} = useSubscriptionForm()

const preview = useFilterPreview(
  () => (dialog.open ? dialog.connectionId : null),
  () => previewFilter.value
)

const distinctId = useId()
const topicField = ref<InstanceType<typeof TopicFilterField> | null>(null)
const options = ref<InstanceType<typeof Mqtt5Options> | null>(null)

const title = computed(() => {
  if (editing.value) return 'Edit subscription'
  return form.multiple ? 'New subscriptions' : 'New subscription'
})
const connectionName = computed(() => profile.value?.name ?? 'this connection')
const shared = computed(() => !form.multiple && isSharedSubscription(form.topic.trim()))
const error = computed(() =>
  missing.value ? 'This subscription no longer exists.' : saveError.value
)

function onOpenChange(open: boolean): void {
  if (!open) ui.closeSubscriptionDialog()
}

function onOpenAutoFocus(event: Event): void {
  event.preventDefault()
  topicField.value?.focus()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || !matchesHotkey(event, SUBMIT_HOTKEY, platform)) return
  // Keep window-level Mod+Enter (publish) away from a dialog submit.
  event.preventDefault()
  event.stopPropagation()
  void save()
}

async function save(): Promise<void> {
  if ((await submit()) !== 'invalid') return
  await nextTick()
  const field = invalidField()
  if (field === 'identifier') {
    await options.value?.focusIdentifier()
    return
  }
  const line = parsed.value?.invalid?.line
  if (form.multiple && line) topicField.value?.selectLine(line)
  else topicField.value?.focus()
}
</script>

<template>
  <Dialog :open="dialog.open" @update:open="onOpenChange">
    <DialogContent
      data-testid="subscription-dialog"
      class="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-lg"
      @open-auto-focus="onOpenAutoFocus"
      @keydown="onKeydown"
    >
      <form class="contents" novalidate @submit.prevent="save">
        <DialogHeader>
          <DialogTitle>{{ title }}</DialogTitle>
          <DialogDescription v-if="editing">
            Change how <span class="font-medium text-foreground">{{ connectionName }}</span>
            subscribes to this filter.
          </DialogDescription>
          <DialogDescription v-else-if="form.multiple">
            Add several filters to
            <span class="font-medium text-foreground">{{ connectionName }}</span> at once, one per
            line.
          </DialogDescription>
          <DialogDescription v-else>
            Messages on <span class="font-medium text-foreground">{{ connectionName }}</span> that
            match the filter show up in the message list.
          </DialogDescription>
        </DialogHeader>

        <div class="-mx-4 min-h-0 overflow-y-auto px-4 py-1 scrollbar-slim">
          <FieldGroup class="gap-5">
            <TopicFilterField
              ref="topicField"
              v-model:topic="form.topic"
              v-model:lines="form.lines"
              v-model:multiple="form.multiple"
              :allow-multiple="!editing"
              :error="topicError ?? linesError"
              :preview="preview"
              :parsed="parsed"
            />

            <div class="grid gap-5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
              <Field>
                <FieldLabel for="subscription-qos">QoS</FieldLabel>
                <QosSelect
                  id="subscription-qos"
                  v-model="form.qos"
                  detailed
                  data-testid="subscription-qos"
                  class="w-full"
                />
              </Field>
              <Field v-if="!form.multiple">
                <FieldLabel for="subscription-alias">
                  Alias <span class="font-normal text-muted-foreground">(optional)</span>
                </FieldLabel>
                <Input
                  id="subscription-alias"
                  v-model="form.alias"
                  data-testid="subscription-alias"
                  placeholder="e.g. Kitchen sensors"
                  autocomplete="off"
                  maxlength="80"
                />
              </Field>
            </div>

            <Field>
              <FieldTitle>Color</FieldTitle>
              <ColorSwatchPicker v-model="form.color" label="Subscription color" />
              <div v-if="form.multiple" class="flex items-center gap-2">
                <Switch
                  :id="distinctId"
                  v-model="distinctColors"
                  size="sm"
                  data-testid="subscription-distinct-colors"
                />
                <label :for="distinctId" class="text-xs text-muted-foreground">
                  Give each a distinct color, starting with this one
                </label>
              </div>
            </Field>

            <Mqtt5Options
              v-if="mqtt5"
              ref="options"
              v-model:open="optionsOpen"
              v-model:no-local="form.noLocal"
              v-model:retain-as-published="form.retainAsPublished"
              v-model:retain-handling="form.retainHandling"
              v-model:identifier="form.identifier"
              :shared="shared"
              :identifier-error="identifierError"
            />
            <p v-else class="flex items-start gap-1.5 text-xs text-muted-foreground">
              <InfoIcon class="mt-px size-3.5 shrink-0" aria-hidden="true" />
              No Local, Retain Handling and subscription identifiers need an MQTT 5.0 connection.
            </p>

            <Alert v-if="error" variant="destructive" data-testid="subscription-error">
              <CircleAlertIcon aria-hidden="true" />
              <AlertDescription>{{ error }}</AlertDescription>
            </Alert>
          </FieldGroup>
        </div>

        <DialogFooter class="sm:items-center">
          <p
            v-if="footerNote"
            class="flex items-center gap-1.5 text-xs text-muted-foreground sm:mr-auto"
          >
            <span
              class="size-1.5 shrink-0 rounded-full"
              :class="connected ? 'bg-success' : 'bg-muted-foreground/50'"
              aria-hidden="true"
            />
            {{ footerNote }}
          </p>
          <Button
            type="button"
            variant="outline"
            data-testid="subscription-cancel"
            @click="ui.closeSubscriptionDialog()"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            data-testid="subscription-save"
            :disabled="saving || missing"
            class="**:data-[slot=kbd]:bg-primary-foreground/15 **:data-[slot=kbd]:text-primary-foreground"
          >
            <Spinner v-if="saving" class="size-3.5" aria-hidden="true" />
            {{ saveLabel }}
            <KbdShortcut :keys="SUBMIT_KEYS" :platform="platform" class="max-sm:hidden" />
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
