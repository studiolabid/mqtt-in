<script setup lang="ts">
/**
 * Global confirm dialog bound to `useUiStore().confirmState` (see `ui.confirm()` /
 * `ui.confirmDestructive()`). Escape and Cancel resolve `false`. The options stay after closing
 * so the exit animation never blanks.
 *
 * Focus: a destructive prompt keeps the alert dialog's default focus on Cancel (A11Y-19), so a
 * stray Delete then Enter changes nothing; confirming takes Tab + Enter, or Mod+Enter. Other
 * prompts focus the confirm button, so Enter confirms.
 */
import { computed, ref } from 'vue'
import { TriangleAlertIcon } from '@lucide/vue'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { hostPlatform } from '@/composables'
import { useUiStore } from '@/stores'
import { matchesHotkey, parseHotkey } from '@/utils/hotkey'
import { SHORTCUTS } from '@/utils/shortcuts'

const SUBMIT_HOTKEY = parseHotkey(SHORTCUTS.submitDialog.combo)

const ui = useUiStore()
const platform = hostPlatform()

const accept = ref<{ $el?: unknown } | null>(null)

const options = computed(() => ui.confirmState.options)
const destructive = computed(() => options.value?.destructive === true)
const confirmText = computed(
  () => options.value?.confirmText ?? (destructive.value ? 'Delete' : 'Confirm')
)
/** `aria-keyshortcuts` of the confirm button (Mod+Enter). */
const confirmKeys = platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter'

/** Dismissal (Escape, Cancel): the confirm button resolves `true` itself. */
function onOpenChange(open: boolean): void {
  if (!open) ui.resolveConfirm(false)
}

function onOpenAutoFocus(event: Event): void {
  // Destructive: the alert dialog's own default (Cancel) stays.
  if (destructive.value) return
  event.preventDefault()
  // The alert dialog focuses Cancel on the next tick: move the focus to the confirm button after.
  setTimeout(() => {
    const el = accept.value?.$el
    if (el instanceof HTMLElement && ui.confirmState.open) el.focus({ preventScroll: true })
  })
}

/** Mod+Enter confirms from anywhere in the dialog (also with Cancel focused). */
function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.repeat || !matchesHotkey(event, SUBMIT_HOTKEY, platform)) return
  event.preventDefault()
  event.stopPropagation()
  ui.resolveConfirm(true)
}
</script>

<template>
  <AlertDialog :open="ui.confirmState.open" @update:open="onOpenChange">
    <AlertDialogContent
      data-testid="confirm-dialog"
      class="duration-150"
      @open-auto-focus="onOpenAutoFocus"
      @keydown="onKeydown"
    >
      <AlertDialogHeader>
        <AlertDialogMedia v-if="destructive" class="bg-destructive/10 text-destructive">
          <TriangleAlertIcon aria-hidden="true" />
        </AlertDialogMedia>
        <AlertDialogTitle class="wrap-anywhere">{{ options?.title }}</AlertDialogTitle>
        <AlertDialogDescription v-if="options?.description" class="wrap-anywhere">
          {{ options.description }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel data-testid="confirm-cancel">
          {{ options?.cancelText ?? 'Cancel' }}
        </AlertDialogCancel>
        <Button
          ref="accept"
          data-testid="confirm-accept"
          :variant="destructive ? 'destructive' : 'default'"
          :aria-keyshortcuts="confirmKeys"
          @click="ui.resolveConfirm(true)"
        >
          {{ confirmText }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
