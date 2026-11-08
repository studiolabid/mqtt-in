/**
 * App information from the main process (versions, data folder, encryption). It never changes
 * while the app runs, so the first successful answer is shared by every caller. Loads when the
 * calling component mounts.
 */
import { onMounted, ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import type { AppInfo } from '@shared/models'
import { api, errorMessage } from '@/services/api'

export interface AppInfoState {
  info: ShallowRef<AppInfo | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  reload(): Promise<void>
}

let cached: Promise<AppInfo> | null = null

function fetchInfo(): Promise<AppInfo> {
  if (!cached) {
    cached = api.app.getInfo().catch((err: unknown) => {
      cached = null
      throw err
    })
  }
  return cached
}

export function useAppInfo(): AppInfoState {
  const info = shallowRef<AppInfo | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)

  async function reload(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      info.value = await fetchInfo()
    } catch (err) {
      error.value = errorMessage(err)
    } finally {
      loading.value = false
    }
  }

  onMounted(() => void reload())

  return { info, loading, error, reload }
}
