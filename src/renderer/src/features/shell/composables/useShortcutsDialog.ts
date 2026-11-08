/**
 * Open state of the keyboard shortcuts dialog (mounted once by the command palette, opened from
 * the palette and the welcome screen).
 */
import { ref, type Ref } from 'vue'

const open = ref(false)

export function useShortcutsDialog(): { open: Ref<boolean>; show(): void } {
  return {
    open,
    show: () => {
      open.value = true
    }
  }
}
