<script setup lang="ts">
/** Dialog footer: status line (save error, validation, reconnect hint) and the actions. */
import { CircleAlertIcon, RefreshCwIcon } from '@lucide/vue'
import { KbdShortcut } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { hostPlatform } from '@/composables/useHotkey'
import { SHORTCUTS } from '@/utils/shortcuts'
import { useConnectionForm, type SaveIntent } from '../../composables/useConnectionForm'

defineProps<{
  /** The running save, if any. */
  saving: SaveIntent | null
  saveError: string | null
  primaryLabel: string
  /** Edited while the session is live: changes apply after a reconnect. */
  reconnectHint: boolean
}>()

const emit = defineEmits<{ cancel: []; save: [intent: SaveIntent] }>()

const { errorCount } = useConnectionForm()
const platform = hostPlatform()
</script>

<template>
  <footer class="flex shrink-0 items-center gap-2 border-t bg-muted/50 px-4 py-3">
    <div class="min-w-0 flex-1 text-xs" aria-live="polite">
      <p v-if="saveError" role="alert" class="flex items-center gap-1.5 text-destructive">
        <CircleAlertIcon class="size-3.5 shrink-0" aria-hidden="true" />
        <span class="truncate select-text" :title="saveError">{{ saveError }}</span>
      </p>
      <p v-else-if="errorCount > 0" class="flex items-center gap-1.5 text-destructive">
        <CircleAlertIcon class="size-3.5 shrink-0" aria-hidden="true" />
        <span class="truncate">
          {{ errorCount === 1 ? 'Fix 1 field to save' : `Fix ${errorCount} fields to save` }}
        </span>
      </p>
      <p v-else-if="reconnectHint" class="flex items-center gap-1.5 text-muted-foreground">
        <RefreshCwIcon class="size-3.5 shrink-0" aria-hidden="true" />
        <span class="truncate">Reconnect to apply changes</span>
      </p>
    </div>
    <Button
      type="button"
      variant="ghost"
      data-testid="connection-cancel"
      :disabled="saving !== null"
      @click="emit('cancel')"
    >
      Cancel
    </Button>
    <Button
      type="button"
      variant="outline"
      data-testid="connection-save"
      :disabled="saving !== null"
      @click="emit('save', 'save')"
    >
      <Spinner v-if="saving === 'save'" />
      Save
    </Button>
    <Button
      type="button"
      data-testid="connection-save-connect"
      :disabled="saving !== null"
      @click="emit('save', 'connect')"
    >
      <Spinner v-if="saving === 'connect'" />
      {{ primaryLabel }}
      <KbdShortcut
        :keys="SHORTCUTS.submitDialog.keys"
        :platform="platform"
        class="ml-1 [&_[data-slot=kbd]]:bg-primary-foreground/15 [&_[data-slot=kbd]]:text-primary-foreground"
      />
    </Button>
  </footer>
</template>
