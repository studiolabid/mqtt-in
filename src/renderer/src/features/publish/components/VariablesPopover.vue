<script setup lang="ts">
/**
 * Template variables cheat sheet: clicking a variable inserts its token into the payload
 * (at the cursor) and turns templates on.
 */
import { ref } from 'vue'
import { VariableIcon } from '@lucide/vue'
import { TEMPLATE_VARIABLES } from '@shared/template'
import { HintTooltip } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const emit = defineEmits<{ insert: [token: string] }>()

const OPEN_BRACES = '{{'

const open = ref(false)
const list = ref<HTMLElement | null>(null)
/** A variable was inserted: focus stays in the editor instead of returning to the trigger. */
let picked = false

function pick(token: string): void {
  picked = true
  open.value = false
  emit('insert', token)
}

function onCloseAutoFocus(event: Event): void {
  if (!picked) return
  picked = false
  event.preventDefault()
}

function onOpenAutoFocus(event: Event): void {
  event.preventDefault()
  list.value?.querySelector<HTMLElement>('button')?.focus()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const buttons = Array.from(list.value?.querySelectorAll<HTMLElement>('button') ?? [])
  const index = buttons.indexOf(document.activeElement as HTMLElement)
  const next = event.key === 'ArrowDown' ? index + 1 : index - 1
  buttons[(next + buttons.length) % buttons.length]?.focus()
}
</script>

<template>
  <Popover v-model:open="open">
    <HintTooltip label="Insert a template variable">
      <PopoverTrigger as-child>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Template variables"
          class="text-muted-foreground"
        >
          <VariableIcon aria-hidden="true" />
        </Button>
      </PopoverTrigger>
    </HintTooltip>
    <PopoverContent
      side="top"
      align="end"
      :side-offset="8"
      class="w-80 gap-1.5 p-1.5"
      @open-auto-focus="onOpenAutoFocus"
      @close-auto-focus="onCloseAutoFocus"
    >
      <div class="px-1.5 pt-1">
        <p class="text-xs font-medium">Template variables</p>
        <p class="text-[11px] text-muted-foreground">
          Rendered when sending. Tip: type
          <span class="font-mono text-foreground/80">{{ OPEN_BRACES }}</span> in the editor to
          complete them.
        </p>
      </div>
      <div
        ref="list"
        role="group"
        aria-label="Template variables"
        class="scrollbar-slim flex max-h-72 flex-col overflow-y-auto"
        @keydown="onKeydown"
      >
        <button
          v-for="variable in TEMPLATE_VARIABLES"
          :key="variable.token"
          type="button"
          class="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
          @click="pick(variable.token)"
        >
          <code
            class="shrink-0 rounded-[4px] bg-primary/10 px-1 py-px font-mono text-[11px] text-primary-text ring-1 ring-primary/20"
            >{{ variable.token }}</code
          >
          <span
            class="min-w-0 truncate text-xs text-muted-foreground"
            :title="variable.description"
          >
            {{ variable.description }}
          </span>
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>
