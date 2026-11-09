<script setup lang="ts">
/**
 * Publisher of a connection (bottom of the workspace). The h-10 header row — topic, QoS,
 * retain, payload format, MQTT 5 properties, history, repeat and Publish — is complete on its
 * own, so the panel keeps working when the parent collapses it to the header. Below: the
 * payload editor with a validation / tools footer.
 *
 * The DOM order is the tab order (topic → QoS → retain → format → payload → Publish →
 * secondary actions → payload tools); a CSS grid places the pieces visually.
 *
 * Narrow header (200 % zoom, a narrow column; A11Y-07): container queries fold controls into a
 * "More" menu instead of letting them overlap. Below 28rem the format, MQTT 5 properties,
 * history and an idle repeat fold; below 20rem QoS and retain too, so topic, More and Publish
 * remain. A running repeat stays visible from 20rem (its count from 32rem, before that only the
 * pulse and the stop button). In a sliver of a panel the topic (under 7.5rem) and then the More
 * button (under 5.5rem) go too: Publish stays visible at any width.
 *
 * Retain on is never just a tinted icon (UX-08): the toggle then shows a filled pin with the
 * "Retain" label at any width, framed in the accent (the message stays on the
 * broker). The panel provides its connection to the history rows (`providePublishConnection`).
 */
import { computed, ref, watch } from 'vue'
import { useElementSize } from '@vueuse/core'
import { PinIcon, SendIcon } from '@lucide/vue'
import { validateTopicName } from '@shared/topic'
import { connectionKind, isMqttProfile } from '@shared/connection-kind'
import { CodeEditor, HintTooltip, QosSelect } from '@/components/common'
import { Toggle } from '@/components/ui/toggle'
import { useHotkey } from '@/composables'
import { useConnectionsStore, usePublishStore, useSessionsStore, useSettingsStore } from '@/stores'
import { SHORTCUTS } from '@/utils/shortcuts'
import FormatSelect from './components/FormatSelect.vue'
import HistoryPopover from './components/HistoryPopover.vue'
import PayloadFooter from './components/PayloadFooter.vue'
import PropertiesPopover from './components/PropertiesPopover.vue'
import PublishButton from './components/PublishButton.vue'
import PublishMoreMenu from './components/PublishMoreMenu.vue'
import RepeatControl from './components/RepeatControl.vue'
import TopicInput from './components/TopicInput.vue'
import { useEditorFocus } from './composables/useEditorFocus'
import { useFoldedControls } from './composables/useFoldedControls'
import { useFormatConversion } from './composables/useFormatConversion'
import { usePublishAction } from './composables/usePublishAction'
import { providePublishConnection } from './composables/usePublishContext'
import { tokenArguments } from './utils/editor'
import { editorLanguage, FORMAT_META, isJsonAuthored } from './utils/payload-tools'

const props = defineProps<{ connectionId: string }>()
providePublishConnection(() => props.connectionId)

const publish = usePublishStore()
const sessions = useSessionsStore()
const connections = useConnectionsStore()
const settings = useSettingsStore()

const draft = computed(() => publish.draft(props.connectionId))
const status = computed(() => sessions.statusOf(props.connectionId))
const profile = computed(() => connections.get(props.connectionId))
/** WebSocket / Socket.IO connections have no QoS, retain or MQTT 5 properties. */
const mqtt = computed(() => !profile.value || isMqttProfile(profile.value))
const isMqtt5 = computed(() => mqtt.value && (profile.value?.protocolVersion ?? 5) === 5)
const topicLabel = computed(() =>
  profile.value && connectionKind(profile.value) === 'socketio' ? 'Event' : 'Topic'
)
const topicError = computed(() => validateTopicName(draft.value.topic))
const job = computed(() => publish.activeJobFor(props.connectionId))
const progress = computed(() => {
  const running = job.value
  return running && running.total > 0 ? Math.min(1, running.sent / running.total) : null
})

const panel = ref<HTMLElement | null>(null)
const topicInput = ref<InstanceType<typeof TopicInput> | null>(null)
const editor = ref<InstanceType<typeof CodeEditor> | null>(null)
const editorCell = ref<HTMLElement | null>(null)
const repeatControl = ref<InstanceType<typeof RepeatControl> | null>(null)

// Narrow header: the folded popovers open against the "More" button.
const folded = useFoldedControls(panel, () => repeatControl.value?.openDialog())
const { propertiesOpen, historyOpen, anchor: foldedAnchor } = folded

// Collapsed by the parent (only the header row visible): keep Tab out of the hidden editor.
const { height: editorHeight } = useElementSize(editorCell)
const collapsed = computed(() => editorHeight.value < 16)

const { focusEditor } = useEditorFocus({
  connectionId: () => props.connectionId,
  editor,
  collapsed
})

const {
  busy,
  succeeded,
  run: runPublish
} = usePublishAction(() => props.connectionId, {
  onInvalidTopic: () => topicInput.value?.revealError()
})

function publishNow(): void {
  void runPublish()
}

// Mod+Enter anywhere in the workspace (inputs and the editor handle it themselves).
useHotkey(SHORTCUTS.publish.combo, publishNow, { ignoreInDialogs: true })

// Switching the format offers to convert the payload (footer).
const conversion = useFormatConversion(() => draft.value)
const { convertFrom } = conversion
watch(() => props.connectionId, conversion.reset)

function convert(): void {
  if (conversion.convert()) focusEditor()
}

/** Inserts a template variable at the cursor (templates are turned on). */
function insertToken(token: string): void {
  draft.value.useTemplate = true
  if (editor.value?.insert(token, tokenArguments(token))) return
  const payload = draft.value.payload
  draft.value.payload = payload + (payload === '' || /\s$/.test(payload) ? '' : ' ') + token
  focusEditor()
}
</script>

<template>
  <section
    ref="panel"
    data-testid="publish-panel"
    aria-label="Publish"
    class="group/publish @container/publish grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,auto)_auto] grid-rows-[2.5rem_minmax(0,1fr)_auto] overflow-clip bg-background"
  >
    <!-- Header rule behind the header controls, with the repeat progress on it. -->
    <div aria-hidden="true" class="pointer-events-none relative col-span-full row-start-1 border-b">
      <div v-if="progress !== null" class="absolute inset-x-0 -bottom-px h-px">
        <div
          class="h-full bg-outgoing transition-[width] duration-200 ease-out"
          :style="{ width: `${progress * 100}%` }"
        />
      </div>
    </div>

    <!-- 1 · topic, QoS, retain (folded below 20rem), format (folded below 28rem) -->
    <div
      class="col-start-1 row-start-1 flex min-w-0 items-center gap-1 pl-1.5 @3xs/publish:pl-3 @md/publish:gap-1.5"
    >
      <div class="mr-1 hidden shrink-0 items-center gap-2 @2xl/publish:flex">
        <SendIcon class="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 class="hidden text-sm font-medium @3xl/publish:block">Publish</h2>
      </div>
      <!-- Under 7.5rem only More and Publish fit: the topic folds away rather than overlap. -->
      <div class="hidden min-w-0 flex-1 @min-[7.5rem]/publish:flex">
        <TopicInput
          ref="topicInput"
          v-model="draft.topic"
          :connection-id="connectionId"
          :error="topicError"
          :label="topicLabel"
          @submit="publishNow"
          @next="focusEditor"
        />
      </div>
      <QosSelect
        v-if="mqtt"
        v-model="draft.qos"
        size="sm"
        data-testid="publish-qos"
        class="hidden shrink-0 pr-1.5 pl-2 @xs/publish:flex"
      />
      <HintTooltip
        v-if="mqtt"
        :label="
          draft.retain
            ? 'Retain on · new subscribers receive this message'
            : 'Retain off · only current subscribers receive it'
        "
      >
        <Toggle
          v-model="draft.retain"
          data-testid="publish-retain"
          variant="outline"
          size="sm"
          aria-label="Retain"
          class="hidden h-7 min-w-7 shrink-0 gap-1 rounded-[min(var(--radius-md),10px)] px-1.5 text-xs text-muted-foreground aria-pressed:border-primary/60 aria-pressed:bg-primary/10 aria-pressed:px-2 aria-pressed:font-medium aria-pressed:text-primary-text @xs/publish:inline-flex @5xl/publish:px-2 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-pressed:bg-primary/15"
        >
          <PinIcon :class="draft.retain && 'fill-current'" aria-hidden="true" />
          <span :class="draft.retain ? 'inline' : 'hidden @5xl/publish:inline'">Retain</span>
        </Toggle>
      </HintTooltip>
      <FormatSelect
        :model-value="draft.format"
        data-testid="publish-format"
        class="hidden shrink-0 @md/publish:flex"
        @update:model-value="conversion.pickFormat"
      />
    </div>

    <!-- 2 · payload editor (framed together with the footer, see the overlay below) -->
    <div
      ref="editorCell"
      data-testid="publish-payload"
      :inert="collapsed"
      class="col-span-full row-start-2 mx-2 mt-2 min-h-0 overflow-hidden rounded-t-lg dark:bg-input/30"
    >
      <CodeEditor
        ref="editor"
        v-model="draft.payload"
        :language="editorLanguage(draft.format)"
        :placeholder="FORMAT_META[draft.format].placeholder"
        :templates="draft.useTemplate"
        :wrap="settings.settings.wordWrap"
        :line-numbers="isJsonAuthored(draft.format)"
        label="Payload"
        min-height="0px"
        class="h-full"
        @submit="publishNow"
      />
    </div>

    <!-- 3 · Publish -->
    <div
      class="col-start-3 row-start-1 flex items-center pr-1.5 pl-0.5 @3xs/publish:pr-3 @md/publish:pl-1"
    >
      <PublishButton :status="status" :busy="busy" :succeeded="succeeded" @publish="publishNow" />
    </div>

    <!-- 4 · properties, history, repeat; "More" below 28rem (not under 5.5rem: Publish only). -->
    <div
      class="col-start-2 row-start-1 flex min-w-0 items-center gap-0.5 overflow-clip pr-1 pl-1 @md/publish:pl-1.5"
    >
      <span class="mr-1 hidden h-4 w-px shrink-0 bg-border @md/publish:block" aria-hidden="true" />
      <div class="hidden items-center gap-0.5 @md/publish:flex">
        <PropertiesPopover
          v-if="isMqtt5"
          v-model:open="propertiesOpen"
          :connection-id="connectionId"
          :reference="foldedAnchor"
          @publish="publishNow"
        />
        <HistoryPopover
          v-model:open="historyOpen"
          :connection-id="connectionId"
          :connected="status === 'connected'"
          :reference="foldedAnchor"
          @loaded="focusEditor"
          @publish="publishNow"
        />
      </div>
      <div :class="job ? 'hidden @xs/publish:flex' : 'hidden @md/publish:flex'">
        <RepeatControl
          ref="repeatControl"
          :connection-id="connectionId"
          @closed="folded.restoreFocus"
        />
      </div>
      <div class="hidden shrink-0 @min-[5.5rem]/publish:flex @md/publish:hidden">
        <PublishMoreMenu
          :connection-id="connectionId"
          :mqtt5="isMqtt5"
          :mqtt="mqtt"
          @open="folded.open"
          @pick-format="conversion.pickFormat"
        />
      </div>
    </div>

    <!-- 5 · validation & payload tools -->
    <PayloadFooter
      :inert="collapsed"
      :connection-id="connectionId"
      :convert-from="convertFrom"
      class="col-span-full row-start-3 mx-2 mb-2"
      @insert="insertToken"
      @convert="convert"
      @edited="focusEditor"
    />

    <!-- One frame around editor and footer: a text-field border, solid focus ring (as Input). -->
    <div
      aria-hidden="true"
      class="pointer-events-none col-span-full row-span-2 row-start-2 m-2 rounded-lg border border-input-border transition-[border-color,box-shadow] duration-150 group-has-[.cm-focused]/publish:border-ring group-has-[.cm-focused]/publish:ring-1 group-has-[.cm-focused]/publish:ring-ring"
    />
  </section>
</template>
