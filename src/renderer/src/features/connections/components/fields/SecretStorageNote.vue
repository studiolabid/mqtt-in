<script setup lang="ts">
/** Tells whether secrets are encrypted at rest on this system. */
import { computed } from 'vue'
import { ShieldAlertIcon, ShieldCheckIcon } from '@lucide/vue'
import { useAppInfo } from '@/composables/useAppInfo'

withDefaults(defineProps<{ subject?: string }>(), { subject: 'Passwords' })

/** `null` while unknown (loading or unavailable). */
const { info } = useAppInfo()
const available = computed(() => info.value?.encryptionAvailable ?? null)
</script>

<template>
  <p
    v-if="available !== null"
    class="flex items-start gap-2 text-xs text-muted-foreground animate-in fade-in-0 duration-150"
  >
    <template v-if="available">
      <ShieldCheckIcon class="mt-px size-3.5 shrink-0 text-success" aria-hidden="true" />
      <span>{{ subject }} are stored encrypted with your system's secure storage.</span>
    </template>
    <template v-else>
      <ShieldAlertIcon class="mt-px size-3.5 shrink-0 text-warning" aria-hidden="true" />
      <span>
        Secure storage is not available on this system: {{ subject.toLowerCase() }} are stored in
        plain text.
      </span>
    </template>
  </p>
</template>
