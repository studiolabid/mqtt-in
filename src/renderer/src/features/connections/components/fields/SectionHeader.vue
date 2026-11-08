<script setup lang="ts">
/** Title and one-line description of a dialog section. */
import { computed } from 'vue'
import { FORM_SECTIONS, type FormSectionId } from '../../utils/sections'

const props = defineProps<{ section: FormSectionId }>()

const info = computed(() => FORM_SECTIONS.find((section) => section.id === props.section))
</script>

<template>
  <header class="flex flex-col gap-1">
    <h3 class="text-sm leading-none font-medium">{{ info?.label }}</h3>
    <p class="text-xs text-muted-foreground">{{ info?.description }}</p>
  </header>
</template>
