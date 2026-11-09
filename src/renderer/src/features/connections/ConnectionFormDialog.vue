<script setup lang="ts">
/**
 * Create / edit a connection profile (singleton, driven by `useUiStore().connectionDialog`).
 *
 * The form edits a plain copy (`connections.create(preset)` or a copy of the saved profile);
 * nothing reaches the store before Save. Errors show after the first save attempt (red dots
 * in the navigation, jump to the first invalid section). Mod+Enter runs the primary action
 * ("Save & connect", or "Save & reconnect" while the session is live). Closing a dirty form
 * asks for confirmation.
 *
 * Keyboard focus: the section panels are not Tab stops (each starts with its own fields,
 * A11Y-22). After a save that opens the workspace, focus starts on its heading instead of
 * returning to a control of the previous view (A11Y-11).
 */
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { connectionKind } from '@shared/connection-kind'
import { toast } from 'vue-sonner'
import type { ConnectionProfile, ConnectionTestResult } from '@shared/models'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { hostPlatform } from '@/composables/useHotkey'
import { useNavigation } from '@/composables/useNavigation'
import { ACTION_TOAST_DURATION } from '@/lib/toast-options'
import { api, errorMessage } from '@/services/api'
import { useConnectionsStore } from '@/stores/connections'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'
import { focusFirst } from '@/utils/focus'
import { matchesHotkey, parseHotkey } from '@/utils/hotkey'
import { SHORTCUTS } from '@/utils/shortcuts'
import FormFooter from './components/form/FormFooter.vue'
import FormHeader from './components/form/FormHeader.vue'
import FormSectionNav from './components/form/FormSectionNav.vue'
import AdvancedSection from './components/sections/AdvancedSection.vue'
import AuthSection from './components/sections/AuthSection.vue'
import GeneralSection from './components/sections/GeneralSection.vue'
import Mqtt5Section from './components/sections/Mqtt5Section.vue'
import SocketSection from './components/sections/SocketSection.vue'
import TlsSection from './components/sections/TlsSection.vue'
import WillSection from './components/sections/WillSection.vue'
import {
  createConnectionForm,
  provideConnectionForm,
  type SaveIntent
} from './composables/useConnectionForm'
import { sectionsFor, type FormSectionId } from './utils/sections'

const SECTIONS: ReadonlyArray<{ id: FormSectionId; component: Component }> = [
  { id: 'general', component: GeneralSection },
  { id: 'socket', component: SocketSection },
  { id: 'auth', component: AuthSection },
  { id: 'tls', component: TlsSection },
  { id: 'advanced', component: AdvancedSection },
  { id: 'will', component: WillSection },
  { id: 'mqtt5', component: Mqtt5Section }
]
const PRIMARY_HOTKEY = parseHotkey(SHORTCUTS.submitDialog.combo)

const ui = useUiStore()
const connections = useConnectionsStore()
const sessions = useSessionsStore()
const navigation = useNavigation()
const platform = hostPlatform()

const form = createConnectionForm({
  onSubmit: () => void submit('connect'),
  groupNames: () => connections.groupNames
})
provideConnectionForm(form)
const { section } = form

/** Saved profile being edited (null = creating). */
const editingId = ref<string | null>(null)
const saving = ref<SaveIntent | null>(null)
const saveError = ref<string | null>(null)
const testing = ref(false)
const testResult = ref<ConnectionTestResult | null>(null)
const body = ref<HTMLElement | null>(null)
/** Bumped on every (re)initialization: a pending "discard?" prompt must not close a newer form. */
let generation = 0
/** Set when a save opened the workspace: focus goes to its heading once the dialog has closed. */
let focusWorkspace = false

const live = computed(() => editingId.value !== null && sessions.isActive(editingId.value))

// Another connection kind hides some sections: leave one that is no longer shown.
watch(
  () => connectionKind(form.draft.value),
  (kind) => {
    if (!sectionsFor(kind).some((entry) => entry.id === section.value)) section.value = 'general'
  }
)
const primaryLabel = computed(() => (live.value ? 'Save & reconnect' : 'Save & connect'))

// (Re)initialize when the dialog opens or is pointed at another profile / preset.
watch(
  () =>
    [ui.connectionDialog.open, ui.connectionDialog.editingId, ui.connectionDialog.preset] as const,
  ([open, id, preset], previous) => {
    if (!open) return
    if (previous && previous[0] && previous[1] === id && previous[2] === preset) return
    start(id, preset)
  },
  { immediate: true }
)

function start(id: string | null, preset: Partial<ConnectionProfile> | null): void {
  generation += 1
  saving.value = null
  saveError.value = null
  testResult.value = null
  if (id === null) {
    editingId.value = null
    form.reset(connections.create(preset ?? undefined), 'create')
    return
  }
  const profile = connections.get(id)
  if (!profile) {
    toast.error('This connection no longer exists')
    ui.closeConnectionDialog()
    return
  }
  editingId.value = id
  form.reset(profile, 'edit')
}

async function persist(id: string | null): Promise<ConnectionProfile> {
  const profile = form.build()
  if (id === null) return connections.save(profile)
  // Fields the dialog does not edit always come from the latest stored version.
  return connections.patch(id, (latest) => ({
    ...profile,
    id: latest.id,
    subscriptions: latest.subscriptions,
    createdAt: latest.createdAt,
    lastConnectedAt: latest.lastConnectedAt
  }))
}

async function submit(intent: SaveIntent): Promise<void> {
  if (saving.value !== null || !ui.connectionDialog.open) return
  const invalid = form.validate()
  if (invalid) {
    section.value = invalid
    focusFirstInvalid()
    return
  }
  const id = editingId.value
  const wasLive = id !== null && sessions.isActive(id)
  saving.value = intent
  saveError.value = null
  let saved: ConnectionProfile
  try {
    saved = await persist(id)
  } catch (err) {
    saveError.value = errorMessage(err)
    return
  } finally {
    saving.value = null
  }

  form.markClean()
  const savedId = saved.id
  focusWorkspace = intent === 'connect' || id === null
  ui.closeConnectionDialog()
  if (intent === 'connect') {
    await navigation.openConnection(savedId)
    await sessions.reconnect(savedId)
    return
  }
  if (id === null) {
    toast.success(`Created “${saved.name}”`)
    await navigation.openConnection(savedId)
  } else if (wasLive) {
    toast.success(`Saved “${saved.name}”`, {
      description: 'Reconnect to apply the changes.',
      action: { label: 'Reconnect', onClick: () => void sessions.reconnect(savedId) },
      duration: ACTION_TOAST_DURATION
    })
  } else {
    toast.success(`Saved “${saved.name}”`)
  }
}

/** One CONNECT with the current (unsaved) settings; the result shows in the footer. */
async function test(): Promise<void> {
  if (testing.value || saving.value !== null) return
  const invalid = form.validate()
  if (invalid) {
    section.value = invalid
    focusFirstInvalid()
    return
  }
  const current = generation
  testing.value = true
  testResult.value = null
  try {
    const result = await api.mqtt.test(form.build())
    if (current === generation) testResult.value = result
  } catch (err) {
    if (current === generation) {
      testResult.value = { ok: false, message: errorMessage(err), clientId: '', durationMs: 0 }
    }
  } finally {
    testing.value = false
  }
}

// A result describes the settings it was made with: any edit clears it.
watch(
  () => form.draft.value,
  () => {
    testResult.value = null
  },
  { deep: true }
)

function focusFirstInvalid(): void {
  // The section's panel mounts on the next render.
  void nextTick(() => body.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
}

async function requestClose(): Promise<void> {
  if (saving.value !== null) return
  if (form.dirty.value) {
    const current = generation
    const discard = await ui.confirm({
      title: 'Discard unsaved changes?',
      description:
        form.mode.value === 'create'
          ? 'The new connection will not be created.'
          : 'Your changes to this connection will be lost.',
      confirmText: 'Discard',
      cancelText: 'Keep editing',
      destructive: true
    })
    if (!discard || current !== generation) return
  }
  ui.closeConnectionDialog()
}

function onOpenChange(open: boolean): void {
  if (!open) void requestClose()
}

/** Starts in the name field (selected for a new profile, so typing replaces "Connection N"). */
function onOpenAutoFocus(event: Event): void {
  const name = body.value?.querySelector<HTMLInputElement>('[data-autofocus]')
  if (!name) return
  event.preventDefault()
  name.focus()
  if (form.mode.value === 'create') name.select()
}

/** After a save that opened the workspace: its heading, not the control that opened the dialog. */
function onCloseAutoFocus(event: Event): void {
  if (!focusWorkspace) return
  focusWorkspace = false
  event.preventDefault()
  void focusFirst(['[data-testid="workspace"] h1'])
}

function onKeydown(event: KeyboardEvent): void {
  // Fields may have handled Enter already (user properties add a row, tags are committed):
  // Mod+Enter still saves from anywhere. A second call while saving is ignored by `submit`.
  const primary =
    !event.isComposing && !event.repeat && matchesHotkey(event, PRIMARY_HOTKEY, platform)
  if (primary) {
    event.preventDefault()
    void submit('connect')
  }
  // A modal owns the keyboard: app shortcuts (clear messages, switch tabs…) must not act
  // behind it. Plain keys (Escape for reka, typing) still propagate.
  if (event.ctrlKey || event.metaKey) event.stopPropagation()
}
</script>

<template>
  <Dialog :open="ui.connectionDialog.open" @update:open="onOpenChange">
    <DialogContent
      data-testid="connection-form"
      :show-close-button="false"
      class="flex h-[min(720px,85vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      @open-auto-focus="onOpenAutoFocus"
      @close-auto-focus="onCloseAutoFocus"
      @keydown="onKeydown"
    >
      <FormHeader />
      <Tabs v-model="section" orientation="vertical" class="min-h-0 flex-1 flex-row gap-0">
        <FormSectionNav />
        <div ref="body" class="relative min-w-0 flex-1">
          <TabsContent
            v-for="entry in SECTIONS"
            :key="entry.id"
            :value="entry.id"
            :tabindex="-1"
            class="absolute inset-0 overflow-y-auto px-6 pt-5 pb-8 scrollbar-slim focus-visible:outline-none"
          >
            <component :is="entry.component" />
          </TabsContent>
        </div>
      </Tabs>
      <FormFooter
        :saving="saving"
        :save-error="saveError"
        :primary-label="primaryLabel"
        :reconnect-hint="live"
        :testing="testing"
        :test-result="testResult"
        @cancel="requestClose"
        @test="test"
        @save="submit"
      />
    </DialogContent>
  </Dialog>
</template>
