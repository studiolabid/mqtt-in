<script setup lang="ts">
import type { HoverCardContentProps } from 'reka-ui'
import { computed, type HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from 'cn'
import {
  HoverCardContent,
  HoverCardPortal,
  injectHoverCardRootContext,
  useForwardProps
} from 'reka-ui'

defineOptions({
  inheritAttrs: false
})

const props = withDefaults(
  defineProps<HoverCardContentProps & { class?: HTMLAttributes['class'] }>(),
  {
    align: 'center',
    sideOffset: 4
  }
)

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)

/**
 * mqtt-in: position against this component's own trigger. reka-ui shares one popper context, so a
 * trigger nested in another popper (a tooltip around a menu button) registers its anchor with
 * the wrong root and the content would never be positioned.
 */
const root = injectHoverCardRootContext()
const reference = computed(() => props.reference ?? root.triggerElement.value)
</script>

<template>
  <HoverCardPortal>
    <HoverCardContent
      data-slot="hover-card-content"
      v-bind="{ ...$attrs, ...forwardedProps }"
      :reference="reference"
      :class="
        cn(
          'data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ring-foreground/10 bg-popover text-popover-foreground w-64 rounded-lg p-2.5 text-sm shadow-md ring-1 duration-100 z-50 origin-(--reka-hover-card-content-transform-origin) outline-hidden',
          props.class
        )
      "
    >
      <slot />
    </HoverCardContent>
  </HoverCardPortal>
</template>
