/**
 * Self-update state of the main process (`api.update`): checked in the background, downloaded
 * automatically, installed by "Restart & update". The "update ready" toast is shown by
 * `app/update-notices`; a manual `check()` reports its own outcome as a toast.
 */
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import { toast } from 'vue-sonner'
import type { UpdateState } from '@shared/models'
import { APP_RELEASES_URL } from '@shared/defaults'
import { ACTION_TOAST_DURATION } from '@/lib/toast-options'
import { api, errorMessage } from '@/services/api'

export const useUpdateStore = defineStore('update', () => {
  const state = shallowRef<UpdateState>({ phase: 'idle', currentVersion: '' })
  /** A manual check is running. */
  const checking = computed(() => state.value.phase === 'checking')
  const ready = computed(() => state.value.phase === 'ready')
  const installing = shallowRef(false)

  /** Reads the current state (call once at startup; later changes arrive via `handle`). */
  async function load(): Promise<void> {
    handle(await api.update.getState())
  }

  /** A state pushed by the main process. */
  function handle(next: UpdateState): void {
    state.value = next
  }

  /** Checks now and says what came out of it. */
  async function check(): Promise<UpdateState> {
    let result: UpdateState
    try {
      result = await api.update.check()
    } catch (err) {
      toast.error('Could not check for updates', { description: errorMessage(err) })
      return state.value
    }
    handle(result)
    report(result)
    return result
  }

  function report(result: UpdateState): void {
    switch (result.phase) {
      case 'up-to-date':
        toast.success('You have the latest version', {
          description: `mqtt-in ${result.currentVersion}`
        })
        break
      case 'downloading':
        toast.info(`mqtt-in ${result.version ?? ''} is downloading`, {
          description: 'You can keep working; you will be asked to restart when it is ready.'
        })
        break
      case 'error':
        toast.error('Could not check for updates', { description: result.message })
        break
      case 'unsupported':
        toast.info('Automatic updates are not available', {
          description: result.message,
          duration: ACTION_TOAST_DURATION,
          action: { label: 'Open releases', onClick: openReleases }
        })
        break
      default:
        // `ready` is announced by app/update-notices.
        break
    }
  }

  /** Saves, disconnects, installs the downloaded version and restarts. */
  async function install(): Promise<boolean> {
    if (installing.value) return false
    installing.value = true
    try {
      await api.update.install()
      return true
    } catch (err) {
      installing.value = false
      toast.error('Could not install the update', { description: errorMessage(err) })
      return false
    }
  }

  function openReleases(): void {
    api.app.openExternal(APP_RELEASES_URL).catch((err: unknown) => {
      console.warn('[mqtt-in] could not open the releases page', err)
    })
  }

  return { state, checking, ready, installing, load, handle, check, install, openReleases }
})
