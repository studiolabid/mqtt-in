<script setup lang="ts">
/**
 * Read-only file path with Browse… (native file picker) and Clear. The end of a long path
 * (the file name) stays visible; the full path is the tooltip. Attributes go to the <input>.
 */
import { nextTick, onMounted, ref, watch, type Component } from 'vue'
import { FileIcon, XIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { FileFilter } from '@shared/models'
import { api, errorMessage } from '@/services/api'
import { InputGroup, InputGroupAddon, InputGroupButton } from '@/components/ui/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import TextInput from './TextInput.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    /** Title of the native dialog. */
    dialogTitle: string
    filters: readonly FileFilter[]
    placeholder?: string
    icon?: Component
    disabled?: boolean
  }>(),
  { placeholder: 'None', icon: () => FileIcon, disabled: false }
)

const model = defineModel<string>({ default: '' })
const input = ref<{ $el?: unknown } | null>(null)
const picking = ref(false)

async function browse(): Promise<void> {
  if (picking.value || props.disabled) return
  picking.value = true
  try {
    const path = await api.dialog.pickFile({
      title: props.dialogTitle,
      filters: [...props.filters, { name: 'All files', extensions: ['*'] }]
    })
    if (path) model.value = path
  } catch (err) {
    toast.error('Could not open the file picker', { description: errorMessage(err) })
  } finally {
    picking.value = false
  }
}

function revealFileName(): void {
  void nextTick(() => {
    const element = input.value?.$el
    if (element instanceof HTMLInputElement) element.scrollLeft = element.scrollWidth
  })
}

watch(model, revealFileName)
onMounted(revealFileName)
</script>

<template>
  <InputGroup>
    <InputGroupAddon>
      <component :is="icon" aria-hidden="true" />
    </InputGroupAddon>
    <TextInput
      ref="input"
      v-bind="$attrs"
      :model-value="model"
      bare
      readonly
      :disabled="disabled"
      :placeholder="placeholder"
      :title="model || undefined"
      class="cursor-default font-mono text-xs md:text-xs"
      @keydown.enter.prevent="browse"
      @dblclick="browse"
    />
    <InputGroupAddon align="inline-end" class="gap-1">
      <Tooltip v-if="model">
        <TooltipTrigger as-child>
          <InputGroupButton
            size="icon-xs"
            aria-label="Clear"
            :disabled="disabled"
            class="text-muted-foreground"
            @click="model = ''"
          >
            <XIcon aria-hidden="true" />
          </InputGroupButton>
        </TooltipTrigger>
        <TooltipContent>Clear</TooltipContent>
      </Tooltip>
      <InputGroupButton variant="secondary" :disabled="disabled || picking" @click="browse">
        Browse…
      </InputGroupButton>
    </InputGroupAddon>
  </InputGroup>
</template>
