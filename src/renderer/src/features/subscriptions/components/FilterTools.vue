<script setup lang="ts">
/**
 * Input-group tools for topic filter fields: `+` / `#` wildcard chips (they keep the caret in
 * the input) and a menu of example filters.
 */
import { BookOpenIcon } from '@lucide/vue'
import { TopicLabel } from '@/components/common'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { InputGroupButton } from '@/components/ui/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { FILTER_EXAMPLES, WILDCARDS, type WildcardToken } from '../utils/filter-lines'

const emit = defineEmits<{
  insert: [token: WildcardToken]
  example: [filter: string]
  /** The examples menu closed: focus belongs back in the input. */
  done: []
}>()

function onCloseAutoFocus(event: Event): void {
  event.preventDefault()
  emit('done')
}
</script>

<template>
  <Tooltip v-for="wildcard in WILDCARDS" :key="wildcard.token">
    <TooltipTrigger as-child>
      <InputGroupButton
        size="icon-xs"
        class="font-mono text-[13px] text-muted-foreground hover:text-foreground"
        :aria-label="`Insert ${wildcard.label.toLowerCase()} ${wildcard.token}`"
        @mousedown.prevent
        @click="emit('insert', wildcard.token)"
      >
        {{ wildcard.token }}
      </InputGroupButton>
    </TooltipTrigger>
    <TooltipContent class="flex-col items-start gap-0.5">
      <span class="font-medium">{{ wildcard.label }}</span>
      <span class="opacity-75">{{ wildcard.hint }}</span>
    </TooltipContent>
  </Tooltip>
  <DropdownMenu>
    <Tooltip>
      <TooltipTrigger as-child>
        <DropdownMenuTrigger as-child>
          <InputGroupButton
            size="icon-xs"
            aria-label="Example filters"
            data-testid="subscription-examples"
            class="text-muted-foreground hover:text-foreground"
          >
            <BookOpenIcon class="size-3.5" />
          </InputGroupButton>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent>Examples</TooltipContent>
    </Tooltip>
    <DropdownMenuContent
      align="end"
      :side-offset="8"
      class="w-72"
      @close-auto-focus="onCloseAutoFocus"
    >
      <DropdownMenuLabel>Examples</DropdownMenuLabel>
      <DropdownMenuItem
        v-for="example in FILTER_EXAMPLES"
        :key="example.filter"
        class="flex-col items-start gap-0.5"
        @select="emit('example', example.filter)"
      >
        <TopicLabel :topic="example.filter" class="text-[13px]" />
        <span class="text-xs text-muted-foreground">{{ example.description }}</span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
