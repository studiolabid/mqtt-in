<script setup lang="ts">
/**
 * Repeat publishing in the header: an icon button that opens the repeat dialog or, while a job
 * runs, a live pill ("Every 1 s · 23 / 100 sent") with a stop button. A finished job leaves a
 * short check on the button. In a narrow header the pill shrinks to its pulse and stop button.
 *
 * The publisher's "More" menu opens the dialog too (`openDialog`); `closed` tells the panel
 * when it closed, so focus can go back to that menu while this control is folded away.
 */
import { computed, nextTick, onScopeDispose, ref, watch } from 'vue'
import { CheckIcon, RepeatIcon, SquareIcon } from '@lucide/vue'
import { HintTooltip } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { usePublishStore } from '@/stores'
import { formatNumber } from '@/utils/format'
import { formatInterval, repeatCount, repeatLabel } from '../utils/repeat'
import PulseDot from './PulseDot.vue'
import RepeatDialog from './RepeatDialog.vue'

const props = defineProps<{ connectionId: string }>()
const emit = defineEmits<{
  /** The repeat dialog closed (after focus went back to whichever repeat control is shown). */
  closed: []
}>()

const FINISHED_FLASH_MS = 2_000

const publish = usePublishStore()
const root = ref<HTMLElement | null>(null)
const dialogOpen = ref(false)
const stopping = ref(false)
const finished = ref<string | null>(null)
let finishedTimer: ReturnType<typeof setTimeout> | undefined

const job = computed(() => publish.activeJobFor(props.connectionId))
const label = computed(() => (job.value ? repeatLabel(job.value) : ''))

watch(
  () => job.value?.jobId,
  (current, previous) => {
    if (current !== undefined || previous === undefined) return
    const last = publish.jobs[previous]
    if (last?.state !== 'completed') return
    finished.value = `Done · sent ${formatNumber(last.sent)} ${last.sent === 1 ? 'message' : 'messages'}`
    if (finishedTimer !== undefined) clearTimeout(finishedTimer)
    finishedTimer = setTimeout(() => (finished.value = null), FINISHED_FLASH_MS)
  }
)

onScopeDispose(() => {
  if (finishedTimer !== undefined) clearTimeout(finishedTimer)
})

/** Focuses whichever repeat control is shown now (icon button or live pill). */
function focusRepeat(onlyWhenLost = false): void {
  void nextTick(() => {
    const active = document.activeElement
    if (onlyWhenLost && active && active !== document.body) return
    root.value?.querySelector<HTMLElement>('[data-testid="publish-repeat"]')?.focus()
  })
}

function onDialogClosed(): void {
  focusRepeat()
  emit('closed')
}

defineExpose({
  /** Opens the repeat dialog (the running job's details while one runs). */
  openDialog: (): void => {
    dialogOpen.value = true
  }
})

async function stop(): Promise<void> {
  const current = job.value
  if (!current || stopping.value) return
  stopping.value = true
  try {
    await publish.stopRepeat(current.jobId)
  } finally {
    stopping.value = false
  }
  // The pill is gone: keep keyboard users in place.
  focusRepeat(true)
}
</script>

<template>
  <div ref="root" class="flex items-center">
    <div
      v-if="job"
      class="flex h-7 items-center overflow-hidden rounded-md bg-outgoing/10 text-outgoing ring-1 ring-outgoing/25 ring-inset animate-in fade-in-0 duration-200"
    >
      <HintTooltip :label="`${label} · show details`">
        <button
          type="button"
          data-testid="publish-repeat"
          :aria-label="`Repeat publishing: ${label}`"
          class="flex h-full items-center gap-1.5 rounded-l-md pr-1.5 pl-2 outline-none transition-colors hover:bg-outgoing/10 focus-visible:bg-outgoing/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          @click="dialogOpen = true"
        >
          <PulseDot />
          <!-- The pulse → "23 / 100" → "1 s · 23 / 100" → "Every 1 s · 23 / 100 sent". -->
          <span
            class="hidden font-mono text-[11px] whitespace-nowrap tabular-nums @lg/publish:inline"
          >
            <span class="hidden @5xl/publish:inline">Every </span>
            <span class="hidden @3xl/publish:inline">{{ formatInterval(job.intervalMs) }} · </span
            ><span>{{ repeatCount(job) }}</span>
            <span class="hidden @5xl/publish:inline"> sent</span>
          </span>
        </button>
      </HintTooltip>
      <span class="h-4 w-px bg-outgoing/25" aria-hidden="true" />
      <HintTooltip label="Stop repeating">
        <button
          type="button"
          data-testid="publish-repeat-stop"
          aria-label="Stop repeating"
          class="flex size-7 items-center justify-center rounded-r-md outline-none transition-colors hover:bg-outgoing/15 focus-visible:bg-outgoing/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-60"
          :disabled="stopping"
          @click="stop"
        >
          <Spinner v-if="stopping" class="size-3" />
          <SquareIcon v-else class="size-2.5 fill-current" aria-hidden="true" />
        </button>
      </HintTooltip>
    </div>
    <HintTooltip v-else :label="finished ?? 'Repeat publishing…'">
      <Button
        data-testid="publish-repeat"
        variant="ghost"
        size="icon-sm"
        aria-label="Repeat publishing"
        @click="dialogOpen = true"
      >
        <CheckIcon
          v-if="finished"
          class="text-success animate-in duration-200 fade-in-0 zoom-in-50"
          aria-hidden="true"
        />
        <RepeatIcon v-else aria-hidden="true" />
      </Button>
    </HintTooltip>
    <RepeatDialog
      v-model:open="dialogOpen"
      :connection-id="connectionId"
      @closed="onDialogClosed"
    />
  </div>
</template>
