<script setup lang="ts">
/**
 * Inline hint with the last connection error (destructive after a failure, warning while
 * reconnecting). Hover / focus shows the full message with Retry and Edit; click copies it.
 */
import { CircleAlertIcon, CopyIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { useCopy } from '@/composables'

const props = defineProps<{
  error: string
  tone: 'destructive' | 'warning'
}>()

const emit = defineEmits<{ retry: []; edit: [] }>()

const { copy } = useCopy()
</script>

<template>
  <HoverCard :open-delay="250" :close-delay="120">
    <HoverCardTrigger as-child>
      <button
        type="button"
        class="flex h-7 max-w-40 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background @3xl/header:max-w-56 @5xl/header:max-w-80"
        :class="
          props.tone === 'destructive'
            ? 'bg-destructive/10 text-destructive hover:bg-destructive/15 dark:bg-destructive/15'
            : 'bg-warning/10 text-foreground/80 hover:bg-warning/15'
        "
        :aria-label="`Connection error: ${props.error}. Click to copy`"
        @click="copy(props.error, 'error message')"
      >
        <CircleAlertIcon
          class="size-3.5 shrink-0"
          :class="props.tone === 'warning' && 'text-warning'"
          aria-hidden="true"
        />
        <span class="truncate">{{ props.error }}</span>
      </button>
    </HoverCardTrigger>
    <HoverCardContent align="end" class="w-80">
      <p class="flex items-center gap-1.5 text-xs font-medium">
        <CircleAlertIcon
          class="size-3.5"
          :class="props.tone === 'destructive' ? 'text-destructive' : 'text-warning'"
          aria-hidden="true"
        />
        {{ props.tone === 'destructive' ? 'Connection failed' : 'Reconnecting — last error' }}
      </p>
      <p class="mt-1.5 text-xs/relaxed wrap-anywhere text-muted-foreground select-text">
        {{ props.error }}
      </p>
      <div class="mt-3 flex items-center gap-1.5">
        <Button v-if="props.tone === 'destructive'" size="xs" @click="emit('retry')">Retry</Button>
        <Button size="xs" variant="outline" @click="emit('edit')">Edit connection</Button>
        <Button
          size="xs"
          variant="ghost"
          class="ml-auto text-muted-foreground"
          @click="copy(props.error, 'error message')"
        >
          <CopyIcon data-icon="inline-start" />
          Copy
        </Button>
      </div>
    </HoverCardContent>
  </HoverCard>
</template>
