<script setup lang="ts">
/** Live status of a running repeat job (inside the repeat dialog), with a stop button. */
import { ref } from 'vue'
import { SquareIcon } from '@lucide/vue'
import type { RepeatJobEvent } from '@shared/models'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { usePublishStore } from '@/stores'
import { repeatLabel } from '../utils/repeat'
import PulseDot from './PulseDot.vue'

const props = defineProps<{ job: RepeatJobEvent }>()

const publish = usePublishStore()
const stopping = ref(false)

async function stop(): Promise<void> {
  if (stopping.value) return
  stopping.value = true
  try {
    await publish.stopRepeat(props.job.jobId)
  } finally {
    stopping.value = false
  }
}
</script>

<template>
  <div
    class="flex items-center gap-2.5 rounded-lg bg-outgoing/10 py-1.5 pr-1.5 pl-3 text-xs text-outgoing ring-1 ring-outgoing/25 ring-inset"
    role="status"
  >
    <PulseDot />
    <span class="min-w-0 flex-1 truncate font-mono tabular-nums">
      Running · {{ repeatLabel(job) }}
    </span>
    <Button
      type="button"
      variant="ghost"
      size="xs"
      class="shrink-0 text-outgoing hover:bg-outgoing/15 hover:text-outgoing"
      :disabled="stopping"
      @click="stop"
    >
      <Spinner v-if="stopping" class="size-3" />
      <SquareIcon v-else class="size-2.5 fill-current" aria-hidden="true" />
      Stop
    </Button>
  </div>
</template>
