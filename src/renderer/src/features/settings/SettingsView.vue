<script setup lang="ts">
/**
 * Settings page (`/settings`): header with Back, an in-page navigation (scroll-spy) beside a
 * centered, scrollable column of sections. Every control applies immediately.
 */
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useNavigation } from '@/composables'
import AboutSection from './components/AboutSection.vue'
import AppearanceSection from './components/AppearanceSection.vue'
import BehaviourSection from './components/BehaviourSection.vue'
import DataSection from './components/DataSection.vue'
import MessagesSection from './components/MessagesSection.vue'
import SettingsHeader from './components/SettingsHeader.vue'
import SettingsNav from './components/SettingsNav.vue'
import ShortcutsSection from './components/ShortcutsSection.vue'
import { provideSettingsSaver } from './composables/useSettingsSaver'
import { useScrollSpy } from './composables/useScrollSpy'
import { sectionDomId, SETTINGS_SECTIONS, type SettingsSectionId } from './utils/options'

const router = useRouter()
const route = useRoute()
const navigation = useNavigation()
const { status } = provideSettingsSaver()

const scroller = ref<HTMLElement | null>(null)
const { active, scrollTo } = useScrollSpy(scroller, {
  ids: SETTINGS_SECTIONS.map((section) => section.id),
  domId: sectionDomId
})

/** `/settings?section=messages` (`useNavigation().openSettings('messages')`) opens a section. */
function requestedSection(): SettingsSectionId | null {
  const value = route.query.section
  return SETTINGS_SECTIONS.find((section) => section.id === value)?.id ?? null
}

function revealRequestedSection(): void {
  const id = requestedSection()
  if (id) void nextTick(() => scrollTo(id))
}

onMounted(revealRequestedSection)
watch(() => route.query.section, revealRequestedSection)

/** Back to where the user came from, or to the welcome screen on a fresh start. */
function goBack(): void {
  const back = router.options.history.state.back
  if (typeof back === 'string' && back !== '') router.back()
  else void navigation.openWelcome()
}
</script>

<template>
  <div data-testid="settings" class="@container/page flex h-full min-h-0 flex-col bg-panel">
    <SettingsHeader :status="status" @back="goBack" />
    <div ref="scroller" class="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
      <div
        class="mx-auto flex w-full max-w-3xl gap-10 px-5 pt-7 pb-16 @4xl/page:max-w-[65.5rem] @4xl/page:px-8"
      >
        <aside
          aria-label="Settings sections"
          class="sticky top-7 hidden w-44 shrink-0 self-start @4xl/page:block"
        >
          <SettingsNav :sections="SETTINGS_SECTIONS" :active="active" @select="scrollTo" />
        </aside>
        <div class="@container/settings min-w-0 max-w-3xl flex-1 space-y-10">
          <AppearanceSection />
          <MessagesSection />
          <BehaviourSection />
          <DataSection />
          <ShortcutsSection />
          <AboutSection />
        </div>
      </div>
    </div>
  </div>
</template>
