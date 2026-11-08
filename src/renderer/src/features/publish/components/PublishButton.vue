<script setup lang="ts">
/**
 * Primary publish action. Disabled until connected (the tooltip says why); a spinner while a
 * slow broker acknowledges, a check flash after success. Label and shortcut hint appear as the
 * panel gets wider (container queries on `@container/publish`).
 */
import { computed } from 'vue'
import { createReusableTemplate } from '@vueuse/core'
import { CheckIcon, SendIcon } from '@lucide/vue'
import type { ConnectionStatus } from '@shared/models'
import { HintTooltip, KbdShortcut } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { SHORTCUTS } from '@/utils/shortcuts'
import { publishAriaShortcut } from '../utils/keys'

const props = defineProps<{
  status: ConnectionStatus
  busy: boolean
  succeeded: boolean
}>()

const emit = defineEmits<{ publish: [] }>()

const [DefineContent, ReuseContent] = createReusableTemplate()

const connected = computed(() => props.status === 'connected')

const hint = computed(() => {
  switch (props.status) {
    case 'connected':
      return 'Publish'
    case 'connecting':
      return 'Connecting…'
    case 'reconnecting':
      return 'Reconnecting…'
    default:
      return 'Connect first'
  }
})

const ariaShortcut = publishAriaShortcut()
const BUTTON_CLASS = 'gap-1.5 px-2 @xl/publish:pr-2.5 @xl/publish:pl-2'
</script>

<template>
  <DefineContent>
    <Spinner v-if="busy" class="size-3.5" />
    <CheckIcon
      v-else-if="succeeded"
      class="animate-in duration-200 fade-in-0 zoom-in-50"
      aria-hidden="true"
    />
    <SendIcon v-else aria-hidden="true" />
    <span class="hidden @xl/publish:inline">Publish</span>
    <KbdShortcut
      :keys="SHORTCUTS.publish.keys"
      title=""
      aria-hidden="true"
      class="ml-0.5 hidden gap-0.5 @4xl/publish:inline-flex *:data-[slot=kbd]:h-4 *:data-[slot=kbd]:min-w-4 *:data-[slot=kbd]:bg-primary-foreground/15 *:data-[slot=kbd]:px-1 *:data-[slot=kbd]:text-[10px] *:data-[slot=kbd]:text-primary-foreground"
    />
  </DefineContent>

  <HintTooltip :label="hint" :keys="connected ? SHORTCUTS.publish.keys : undefined">
    <Button
      v-if="connected"
      data-testid="publish-button"
      size="sm"
      aria-label="Publish"
      :aria-keyshortcuts="ariaShortcut"
      :aria-busy="busy || undefined"
      :class="BUTTON_CLASS"
      @click="emit('publish')"
    >
      <ReuseContent />
    </Button>
    <!-- A disabled button gets no pointer events: the wrapper receives the hover instead. -->
    <span v-else class="inline-flex rounded-lg">
      <Button
        data-testid="publish-button"
        size="sm"
        aria-label="Publish"
        disabled
        :class="BUTTON_CLASS"
      >
        <ReuseContent />
      </Button>
    </span>
  </HintTooltip>
</template>
