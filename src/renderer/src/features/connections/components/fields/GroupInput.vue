<script setup lang="ts">
/**
 * Group name with the existing groups one click away; typing a new name creates a group.
 * Attributes go to the <input>.
 */
import { CheckIcon, ChevronDownIcon, FolderIcon, FolderXIcon } from '@lucide/vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupButton } from '@/components/ui/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import TextInput from './TextInput.vue'

defineOptions({ inheritAttrs: false })

defineProps<{ suggestions: readonly string[] }>()

const model = defineModel<string>({ default: '' })
</script>

<template>
  <InputGroup>
    <InputGroupAddon>
      <FolderIcon aria-hidden="true" />
    </InputGroupAddon>
    <TextInput v-bind="$attrs" v-model="model" bare placeholder="No group" maxlength="256" />
    <InputGroupAddon v-if="suggestions.length > 0" align="inline-end">
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger as-child>
            <DropdownMenuTrigger as-child>
              <InputGroupButton size="icon-xs" aria-label="Choose an existing group">
                <ChevronDownIcon aria-hidden="true" />
              </InputGroupButton>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Existing groups</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" class="w-56">
          <DropdownMenuLabel>Groups</DropdownMenuLabel>
          <DropdownMenuItem v-for="name in suggestions" :key="name" @select="model = name">
            <FolderIcon aria-hidden="true" />
            <span class="truncate" :title="name">{{ name }}</span>
            <CheckIcon v-if="model.trim() === name" class="ml-auto" aria-hidden="true" />
          </DropdownMenuItem>
          <template v-if="model.trim() !== ''">
            <DropdownMenuSeparator />
            <DropdownMenuItem @select="model = ''">
              <FolderXIcon aria-hidden="true" />
              No group
            </DropdownMenuItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>
    </InputGroupAddon>
  </InputGroup>
</template>
