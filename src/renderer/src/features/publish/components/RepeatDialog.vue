<script setup lang="ts">
/**
 * Repeat publishing: sends the current draft every interval (ms / s / min, at least 10 ms),
 * a number of times (0 = until stopped). Shows the first rendered message when templates are
 * on. Starting replaces a job that already runs on this connection (one job at a time).
 */
import { computed, ref, useId, watch } from 'vue'
import { PlayIcon, RepeatIcon } from '@lucide/vue'
import { validateTopicName } from '@shared/topic'
import { TopicLabel } from '@/components/common'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { usePublishStore, useSessionsStore } from '@/stores'
import { rememberedRepeat, rememberRepeat } from '../composables/useRepeatMemory'
import { useRepeatSample } from '../composables/useRepeatSample'
import {
  formatInterval,
  INTERVAL_PRESETS,
  INTERVAL_UNITS,
  isIntervalUnit,
  repeatSummary,
  splitInterval,
  toIntervalMs,
  validateRepeat,
  type IntervalUnit
} from '../utils/repeat'
import RepeatPreview from './RepeatPreview.vue'
import RepeatRunning from './RepeatRunning.vue'

const props = defineProps<{ connectionId: string }>()
const open = defineModel<boolean>('open', { required: true })

const emit = defineEmits<{
  /**
   * The dialog closed and would return focus to its trigger, which may have been replaced in
   * the meantime (button ⇄ live pill): the parent moves focus itself.
   */
  closed: []
}>()

function onCloseAutoFocus(event: Event): void {
  event.preventDefault()
  emit('closed')
}

/** Start in the interval field (not on "Stop" while a job runs). */
function onOpenAutoFocus(event: Event): void {
  const input = document.getElementById(intervalId)
  if (!(input instanceof HTMLInputElement)) return
  event.preventDefault()
  input.focus()
  input.select()
}

const publish = usePublishStore()
const sessions = useSessionsStore()
const { sample, reroll } = useRepeatSample(() => props.connectionId)

const formId = useId()
const intervalId = useId()
const countId = useId()

const intervalText = ref<string | number>('1')
const unit = ref<IntervalUnit>('s')
const countText = ref<string | number>('0')
const starting = ref(false)

const draft = computed(() => publish.draft(props.connectionId))
const job = computed(() => publish.activeJobFor(props.connectionId))
const connected = computed(() => sessions.isConnected(props.connectionId))

const intervalMs = computed(() => {
  const text = String(intervalText.value).trim()
  return text === '' ? Number.NaN : toIntervalMs(Number(text), unit.value)
})
const count = computed(() => {
  const text = String(countText.value).trim()
  return text === '' ? 0 : Number(text)
})
const errors = computed(() => validateRepeat(intervalMs.value, count.value))
const topicError = computed(() => validateTopicName(draft.value.topic))
const valid = computed(() => !errors.value.interval && !errors.value.count)
const canStart = computed(
  () =>
    valid.value &&
    connected.value &&
    !starting.value &&
    topicError.value === null &&
    sample.value.error === null
)
const summary = computed(() => {
  if (!connected.value) return 'Connect first to start repeating.'
  return valid.value ? repeatSummary(intervalMs.value, count.value) : ''
})

watch(open, (isOpen) => {
  if (!isOpen) return
  const settings = rememberedRepeat(props.connectionId)
  const split = splitInterval(settings.intervalMs)
  intervalText.value = String(split.value)
  unit.value = split.unit
  countText.value = String(settings.count)
  reroll()
})

function setUnit(value: unknown): void {
  if (isIntervalUnit(value)) unit.value = value
}

function applyPreset(ms: number): void {
  const split = splitInterval(ms)
  intervalText.value = String(split.value)
  unit.value = split.unit
}

async function start(): Promise<void> {
  if (!canStart.value) return
  starting.value = true
  try {
    for (const running of publish.jobsFor(props.connectionId)) {
      if (running.state === 'running') await publish.stopRepeat(running.jobId)
    }
    const settings = { intervalMs: intervalMs.value, count: count.value }
    const jobId = await publish.startRepeat(props.connectionId, settings)
    if (jobId !== null) {
      rememberRepeat(props.connectionId, settings)
      open.value = false
    }
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="gap-5 sm:max-w-md"
      @open-auto-focus="onOpenAutoFocus"
      @close-auto-focus="onCloseAutoFocus"
    >
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <RepeatIcon class="size-4 text-muted-foreground" aria-hidden="true" />
          Repeat publishing
        </DialogTitle>
        <DialogDescription class="flex min-w-0 items-center gap-1 text-xs">
          <span class="shrink-0">Sends the current draft to</span>
          <TopicLabel :topic="draft.topic" class="min-w-0 text-foreground" />
        </DialogDescription>
        <p v-if="topicError" class="text-xs text-destructive" role="alert">
          {{ topicError }}. Fix the topic in the publisher first.
        </p>
      </DialogHeader>

      <RepeatRunning v-if="job" :job="job" />

      <form :id="formId" class="grid gap-4" novalidate @submit.prevent="start">
        <div class="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-3">
          <div class="grid content-start gap-1.5">
            <Label :for="intervalId" class="text-xs">Interval</Label>
            <div class="flex gap-1.5">
              <Input
                :id="intervalId"
                v-model="intervalText"
                type="number"
                inputmode="decimal"
                min="0"
                step="any"
                autocomplete="off"
                :aria-invalid="errors.interval ? true : undefined"
                class="font-mono tabular-nums [&::-webkit-inner-spin-button]:appearance-none"
              />
              <Select :model-value="unit" @update:model-value="setUnit">
                <SelectTrigger class="w-20 shrink-0" aria-label="Interval unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="item in INTERVAL_UNITS" :key="item.value" :value="item.value">
                    {{ item.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p v-if="errors.interval" class="text-xs text-destructive" role="alert">
              {{ errors.interval }}
            </p>
            <div v-else class="flex flex-wrap gap-1" role="group" aria-label="Interval presets">
              <Button
                v-for="preset in INTERVAL_PRESETS"
                :key="preset"
                type="button"
                variant="outline"
                size="xs"
                :aria-pressed="intervalMs === preset"
                class="h-5 rounded-full px-2 font-mono text-[11px] font-normal text-muted-foreground aria-pressed:border-primary/60 aria-pressed:bg-primary/10 aria-pressed:text-primary-text aria-pressed:inset-ring-1 aria-pressed:inset-ring-primary/60"
                @click="applyPreset(preset)"
              >
                {{ formatInterval(preset) }}
              </Button>
            </div>
          </div>
          <div class="grid content-start gap-1.5">
            <Label :for="countId" class="text-xs">Messages</Label>
            <Input
              :id="countId"
              v-model="countText"
              type="number"
              inputmode="numeric"
              min="0"
              step="1"
              placeholder="0"
              autocomplete="off"
              :aria-invalid="errors.count ? true : undefined"
              class="font-mono tabular-nums [&::-webkit-inner-spin-button]:appearance-none"
            />
            <p class="text-xs" :class="errors.count ? 'text-destructive' : 'text-muted-foreground'">
              {{ errors.count ?? '0 = until stopped' }}
            </p>
          </div>
        </div>

        <RepeatPreview :sample="sample" :format="draft.format" @reroll="reroll" />
      </form>

      <DialogFooter class="sm:items-center">
        <p class="text-xs text-muted-foreground sm:mr-auto">{{ summary }}</p>
        <Button type="button" variant="outline" @click="open = false">Cancel</Button>
        <Button
          type="submit"
          :form="formId"
          data-testid="publish-repeat-start"
          :disabled="!canStart"
        >
          <Spinner v-if="starting" />
          <PlayIcon v-else aria-hidden="true" />
          {{ job ? 'Restart' : 'Start' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
