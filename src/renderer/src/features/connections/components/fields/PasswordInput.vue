<script setup lang="ts">
/** Secret input with a show / hide toggle. Attributes go to the <input>. */
import { ref, type HTMLAttributes } from 'vue'
import { EyeIcon, EyeOffIcon } from '@lucide/vue'
import { InputGroup, InputGroupAddon, InputGroupButton } from '@/components/ui/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import TextInput from './TextInput.vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{ class?: HTMLAttributes['class'] }>()

const model = defineModel<string>({ default: '' })
const visible = ref(false)
</script>

<template>
  <InputGroup :class="props.class">
    <TextInput
      v-bind="$attrs"
      v-model="model"
      bare
      :type="visible ? 'text' : 'password'"
      class="font-mono"
    />
    <InputGroupAddon align="inline-end">
      <Tooltip>
        <TooltipTrigger as-child>
          <InputGroupButton
            size="icon-xs"
            :aria-label="visible ? 'Hide' : 'Show'"
            :aria-pressed="visible"
            @click="visible = !visible"
          >
            <EyeOffIcon v-if="visible" aria-hidden="true" />
            <EyeIcon v-else aria-hidden="true" />
          </InputGroupButton>
        </TooltipTrigger>
        <TooltipContent>{{ visible ? 'Hide' : 'Show' }}</TooltipContent>
      </Tooltip>
    </InputGroupAddon>
  </InputGroup>
</template>
