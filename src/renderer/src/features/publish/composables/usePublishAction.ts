/**
 * Publishing a connection's draft with calm feedback: a spinner only when the broker takes a
 * moment, a short success flash (no toast), a "Connect first" hint with a Connect action when
 * disconnected, and a hook to point at an invalid topic instead of toasting it.
 *
 * A retained publish is the exception: the broker keeps it and replays it to every subscriber
 * that connects later (a forgotten Retain re-runs a command on every reconnect), so a toast
 * says so and offers Undo, which clears the retained message with an empty retained publish.
 */
import { onScopeDispose, readonly, ref, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import { validateTopicName } from '@shared/topic'
import { clearQos } from '@/features/topics/utils/clear-retained'
import { ACTION_TOAST_DURATION } from '@/lib/toast-options'
import { usePublishStore, useSessionsStore } from '@/stores'

/** The spinner only appears when a publish is still in flight after this delay. */
const SPINNER_DELAY_MS = 150
/** Duration of the success state (check icon on the button). */
const SUCCESS_FLASH_MS = 1_000

export interface PublishActionHooks {
  /** Called instead of publishing when the topic is invalid (e.g. focus the topic input). */
  onInvalidTopic?: () => void
}

export interface PublishAction {
  /** A publish has been in flight for a moment. */
  busy: Readonly<Ref<boolean>>
  /** True for ~1 s after a successful publish. */
  succeeded: Readonly<Ref<boolean>>
  /** Publishes the draft. Errors are toasted by the store. */
  run(): Promise<boolean>
}

export function usePublishAction(
  connectionId: MaybeRefOrGetter<string>,
  hooks: PublishActionHooks = {}
): PublishAction {
  const publish = usePublishStore()
  const sessions = useSessionsStore()
  const busy = ref(false)
  const succeeded = ref(false)
  let inFlight = 0
  let spinnerTimer: ReturnType<typeof setTimeout> | undefined
  let flashTimer: ReturnType<typeof setTimeout> | undefined

  function suggestConnect(id: string): void {
    toast.info('Connect first', {
      id: `publish-connect-first:${id}`,
      description: 'Messages can only be published while the connection is up.',
      action: { label: 'Connect', onClick: () => void sessions.connect(id) },
      duration: ACTION_TOAST_DURATION
    })
  }

  async function clearRetained(id: string, topic: string): Promise<void> {
    const ok = await publish.publish(
      id,
      {
        topic,
        payload: '',
        format: 'text',
        retain: true,
        qos: clearQos(sessions.brokerInfo(id)?.maximumQoS),
        useTemplate: false,
        properties: { userProperties: [] }
      },
      { history: false }
    )
    if (ok) toast.success('Retained message cleared', { description: topic })
  }

  function offerUndo(id: string, topic: string): void {
    toast.info(`Retained on ${topic}`, {
      id: `publish-retained:${id}:${topic}`,
      description: 'The broker keeps it and sends it to every client that subscribes later.',
      action: { label: 'Undo', onClick: () => void clearRetained(id, topic) },
      duration: ACTION_TOAST_DURATION
    })
  }

  function settle(): void {
    if (spinnerTimer !== undefined) clearTimeout(spinnerTimer)
    spinnerTimer = undefined
    busy.value = false
  }

  function flash(): void {
    succeeded.value = true
    if (flashTimer !== undefined) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      flashTimer = undefined
      succeeded.value = false
    }, SUCCESS_FLASH_MS)
  }

  async function run(): Promise<boolean> {
    const id = toValue(connectionId)
    if (!sessions.isConnected(id)) {
      suggestConnect(id)
      return false
    }
    if (hooks.onInvalidTopic && validateTopicName(publish.draft(id).topic) !== null) {
      hooks.onInvalidTopic()
      return false
    }
    const { topic, retain, payload } = publish.draft(id)
    inFlight++
    spinnerTimer ??= setTimeout(() => {
      spinnerTimer = undefined
      busy.value = inFlight > 0
    }, SPINNER_DELAY_MS)
    let ok: boolean
    try {
      ok = await publish.publish(id)
    } finally {
      inFlight--
      if (inFlight === 0) settle()
    }
    if (ok) {
      flash()
      // An empty retained payload is itself a clear: nothing to undo.
      if (retain && payload !== '') offerUndo(id, topic)
    }
    return ok
  }

  onScopeDispose(() => {
    settle()
    if (flashTimer !== undefined) clearTimeout(flashTimer)
  })

  return { busy: readonly(busy), succeeded: readonly(succeeded), run }
}
