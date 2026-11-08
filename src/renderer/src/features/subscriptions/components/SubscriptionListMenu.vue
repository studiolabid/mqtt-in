<script setup lang="ts">
/** Overflow menu of the subscription panel header: add multiple, copy all, bulk enable. */
import {
  ClipboardCopyIcon,
  EllipsisIcon,
  ListPlusIcon,
  ToggleLeftIcon,
  ToggleRightIcon
} from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

defineProps<{
  total: number
  enabled: number
}>()

const emit = defineEmits<{
  addMultiple: []
  copyAll: []
  setAllEnabled: [enabled: boolean]
}>()
</script>

<template>
  <DropdownMenu>
    <Tooltip>
      <TooltipTrigger as-child>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="More subscription actions"
            data-testid="subscription-menu"
            class="text-muted-foreground"
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent>More actions</TooltipContent>
    </Tooltip>
    <DropdownMenuContent align="end" class="w-48">
      <DropdownMenuItem @select="emit('addMultiple')">
        <ListPlusIcon />
        Add multiple…
      </DropdownMenuItem>
      <DropdownMenuItem :disabled="total === 0" @select="emit('copyAll')">
        <ClipboardCopyIcon />
        Copy all filters
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem :disabled="enabled === total" @select="emit('setAllEnabled', true)">
        <ToggleRightIcon />
        Enable all
      </DropdownMenuItem>
      <DropdownMenuItem :disabled="enabled === 0" @select="emit('setAllEnabled', false)">
        <ToggleLeftIcon />
        Disable all
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
