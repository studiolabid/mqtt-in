<script setup lang="ts">
/** Empty subscription list: the primary "Add subscription" plus one-click `#` and `$SYS/#`. */
import { PlusIcon, SatelliteDishIcon } from '@lucide/vue'
import { EmptyState } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

defineProps<{
  /** Filter being quick-added (its button spins, the others wait). */
  busy: string | null
}>()

const emit = defineEmits<{
  add: []
  quickAdd: [topic: string]
}>()

const QUICK_ADD = [
  { topic: '#', hint: 'Everything (every topic except $SYS)', testId: 'subscription-quick-all' },
  { topic: '$SYS/#', hint: 'Broker statistics ($SYS topics)', testId: 'subscription-quick-sys' }
] as const
</script>

<template>
  <div class="flex min-h-0 flex-1 overflow-y-auto scrollbar-slim">
    <EmptyState
      compact
      :icon="SatelliteDishIcon"
      title="No subscriptions"
      description="Subscribe to a topic filter to start receiving messages."
    >
      <Button size="sm" data-testid="subscription-empty-add" @click="emit('add')">
        <PlusIcon aria-hidden="true" />
        Add subscription
      </Button>
      <div class="flex w-full flex-wrap items-center justify-center gap-1.5">
        <span class="text-xs text-muted-foreground">Quick add</span>
        <Tooltip v-for="item in QUICK_ADD" :key="item.topic">
          <TooltipTrigger as-child>
            <Button
              variant="outline"
              size="xs"
              class="font-mono"
              :data-testid="item.testId"
              :aria-label="`Subscribe to ${item.topic}: ${item.hint}`"
              :disabled="busy !== null"
              @click="emit('quickAdd', item.topic)"
            >
              <Spinner v-if="busy === item.topic" class="size-3" aria-hidden="true" />
              {{ item.topic }}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ item.hint }}</TooltipContent>
        </Tooltip>
      </div>
    </EmptyState>
  </div>
</template>
