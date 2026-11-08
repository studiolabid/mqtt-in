<script setup lang="ts">
/**
 * Copy-to-clipboard icon button. `value` may be a function so expensive strings are only
 * built on click. Shows a check for 1.5 s and a toast; never lets the click bubble (safe in
 * clickable rows). The default slot can add a text label next to the icon.
 */
import { ref, type HTMLAttributes } from 'vue'
import { CheckIcon, CopyIcon } from '@lucide/vue'
import { useTimeoutFn } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { Button, type ButtonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { copyText } from './lib/clipboard'

const props = withDefaults(
  defineProps<{
    value: string | (() => string)
    /** What is copied, e.g. `topic` → toast "Copied topic", aria-label "Copy topic". */
    label?: string
    size?: ButtonVariants['size']
    variant?: ButtonVariants['variant']
    class?: HTMLAttributes['class']
  }>(),
  { size: 'icon-xs', variant: 'ghost' }
)

const emit = defineEmits<{
  /** After a successful copy, with the copied text. */
  copied: [text: string]
}>()

const copied = ref(false)
const { start: scheduleReset } = useTimeoutFn(
  () => {
    copied.value = false
  },
  1500,
  { immediate: false }
)

async function copy(): Promise<void> {
  try {
    const text = typeof props.value === 'function' ? props.value() : props.value
    await copyText(text)
    copied.value = true
    scheduleReset()
    toast.success(props.label ? `Copied ${props.label}` : 'Copied to clipboard')
    emit('copied', text)
  } catch {
    toast.error(props.label ? `Could not copy ${props.label}` : 'Could not copy to clipboard')
  }
}
</script>

<template>
  <Button
    type="button"
    data-slot="copy-button"
    :variant="variant"
    :size="size"
    :class="cn('text-muted-foreground hover:text-foreground', props.class)"
    :aria-label="label ? `Copy ${label}` : 'Copy'"
    :title="label ? `Copy ${label}` : 'Copy'"
    @click.stop="copy"
  >
    <CheckIcon
      v-if="copied"
      class="text-success animate-in fade-in-0 zoom-in-50 duration-150"
      aria-hidden="true"
    />
    <CopyIcon v-else aria-hidden="true" />
    <slot />
  </Button>
</template>
