<script setup lang="ts">
/**
 * Settings page header (h-12): Back, title and the quiet autosave indicator. When the page opens
 * after a navigation that removed the focused element, keyboard focus starts on its heading
 * (A11Y-11); Back returns to the previous view, which does the same with its own heading.
 */
import { onMounted, ref } from 'vue'
import { ArrowLeftIcon, CheckIcon, SettingsIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import type { SaveStatus } from '../composables/useSettingsSaver'

defineProps<{ status: SaveStatus }>()

const emit = defineEmits<{ back: [] }>()

const heading = ref<HTMLElement | null>(null)

onMounted(() => {
  const active = document.activeElement
  if (!active || active === document.body) heading.value?.focus({ preventScroll: true })
})
</script>

<template>
  <header class="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
    <Button
      variant="ghost"
      size="sm"
      data-testid="settings-back"
      class="text-muted-foreground hover:text-foreground"
      @click="emit('back')"
    >
      <ArrowLeftIcon aria-hidden="true" />
      Back
    </Button>
    <Separator orientation="vertical" class="h-4 data-[orientation=vertical]:self-center" />
    <div class="flex min-w-0 items-center gap-2 pl-1">
      <SettingsIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <h1 ref="heading" tabindex="-1" class="truncate text-sm font-semibold outline-none">
        Settings
      </h1>
    </div>
    <div class="ml-auto flex shrink-0 items-center pr-1 text-xs" aria-live="polite">
      <Transition
        mode="out-in"
        enter-active-class="transition-opacity duration-150"
        enter-from-class="opacity-0"
        leave-active-class="transition-opacity duration-100"
        leave-to-class="opacity-0"
      >
        <span v-if="status === 'saved'" key="saved" class="flex items-center gap-1.5">
          <CheckIcon class="size-3.5 text-success" aria-hidden="true" />
          Saved
        </span>
        <span v-else key="idle" class="hidden text-muted-foreground @md/page:inline">
          Changes apply instantly
        </span>
      </Transition>
    </div>
  </header>
</template>
