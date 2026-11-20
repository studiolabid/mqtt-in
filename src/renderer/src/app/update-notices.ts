/**
 * "Update ready" notification: once a newer version is downloaded, a toast offers to restart
 * into it (it stays until dismissed). Ignored, the update installs when the app quits.
 * One toast per version, queued until the app is mounted.
 */
import { watch } from 'vue'
import { toast } from 'vue-sonner'
import { releaseUrl } from '@shared/defaults'
import { STICKY_TOAST_DURATION } from '@/lib/toast-options'
import { api } from '@/services/api'
import { useUpdateStore } from '@/stores/update'
import { whenMounted } from './notices'

export const UPDATE_TOAST_ID = 'update-ready'

/** The store already watched (one watcher per Pinia instance). */
let watched: ReturnType<typeof useUpdateStore> | null = null

/** Watches the update state and announces each downloaded version once. Requires Pinia. */
export function watchUpdateReady(): void {
  const update = useUpdateStore()
  if (watched === update) return
  watched = update
  let announced: string | null = null
  watch(
    () => update.state,
    (state) => {
      if (state.phase !== 'ready' || !state.version || state.version === announced) return
      const version = state.version
      announced = version
      whenMounted(() =>
        toast.success(`mqtt-in ${version} is ready to install`, {
          id: UPDATE_TOAST_ID,
          description:
            'Restart to update. Your connections, settings and history stay as they are.',
          duration: STICKY_TOAST_DURATION,
          action: { label: 'Restart now', onClick: () => void update.install() },
          cancel: {
            label: "What's new",
            onClick: () => void api.app.openExternal(releaseUrl(version)).catch(() => undefined)
          }
        })
      )
    },
    { immediate: true }
  )
}
