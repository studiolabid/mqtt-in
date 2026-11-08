<script setup lang="ts">
/**
 * The first message of a repeat job (read-only), with a re-roll button for templates and a
 * note on how templates behave per message.
 */
import { CircleAlertIcon, InfoIcon, RefreshCwIcon } from '@lucide/vue'
import type { PayloadFormat } from '@shared/models'
import { CodeEditor, HintTooltip } from '@/components/common'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/utils/format'
import type { RepeatSample } from '../composables/useRepeatSample'
import { editorLanguage } from '../utils/payload-tools'

defineProps<{
  sample: RepeatSample
  format: PayloadFormat
}>()

const emit = defineEmits<{ reroll: [] }>()

const COUNTER_TOKEN = '{{counter}}'
</script>

<template>
  <div class="grid gap-1.5">
    <div class="flex h-6 items-center justify-between gap-2">
      <span class="text-xs font-medium">
        {{ sample.templated ? 'First message' : 'Every message' }}
        <span v-if="!sample.error" class="ml-1 font-mono font-normal text-muted-foreground">
          {{ formatBytes(sample.bytes) }}
        </span>
      </span>
      <HintTooltip v-if="sample.templated" label="Render again">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Render the first message again"
          class="text-muted-foreground"
          @click="emit('reroll')"
        >
          <RefreshCwIcon aria-hidden="true" />
        </Button>
      </HintTooltip>
    </div>
    <div
      class="overflow-hidden rounded-lg border border-input bg-muted/30 dark:bg-input/30"
      :class="sample.error && 'border-destructive/50'"
    >
      <CodeEditor
        :model-value="sample.text"
        readonly
        :language="editorLanguage(format)"
        placeholder="Empty payload"
        label="First message preview"
        min-height="2rem"
        max-height="9rem"
      />
    </div>
    <p v-if="sample.error" class="flex items-start gap-1.5 text-xs text-destructive" role="alert">
      <CircleAlertIcon class="mt-px size-3.5 shrink-0" aria-hidden="true" />
      {{ sample.error }}
    </p>
    <p v-else class="flex items-start gap-1.5 text-xs text-muted-foreground">
      <InfoIcon class="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span v-if="sample.templated">
        Template variables are rendered for every message:
        <code class="font-mono text-foreground/80">{{ COUNTER_TOKEN }}</code> counts 1, 2, 3…
      </span>
      <span v-else-if="sample.literalTokens">
        Templates are off: the tokens are sent literally. Turn on Template in the editor to render
        them.
      </span>
      <span v-else>Every message carries the payload exactly as written.</span>
    </p>
  </div>
</template>
