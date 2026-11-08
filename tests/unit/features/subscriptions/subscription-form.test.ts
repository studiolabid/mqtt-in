import { describe, expect, it, vi } from 'vitest'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() })
}))

import { NEUTRAL_COLOR, PALETTE } from '@shared/defaults'
import { useSubscriptionForm } from '@/features/subscriptions/composables/useSubscriptionForm'
import { hasMqtt5Options } from '@/features/subscriptions/utils/form'
import { mqtt5Labels } from '@/features/subscriptions/utils/subscription-view'
import { useSubscriptionsStore, useUiStore } from '@/stores'
import { createSubscription } from '@shared/defaults'
import { setupStores } from '../../renderer/stores/setup'
import { settle } from '../../renderer/helpers'

const COLORED = [
  { topic: 'a/#', color: '#22c55e' },
  { topic: 'b/#', color: '#3b82f6' }
]

async function openDialog(options: { multiple?: boolean } = {}): Promise<string> {
  const { profiles } = await setupStores([
    { name: 'v5', protocolVersion: 5, subscriptions: COLORED.map((s) => createSubscription(s)) }
  ])
  const id = profiles[0].id
  useUiStore().openNewSubscription(id, undefined, options)
  return id
}

describe('subscription form defaults (UX-07, PRODUCT-03)', () => {
  it('starts neutral gray whatever colors the list holds', async () => {
    await openDialog()
    const { form } = useSubscriptionForm()
    expect(form.color).toBe(NEUTRAL_COLOR)
  })

  it('turns Retain As Published on by default, and keeps the MQTT 5 options closed', async () => {
    await openDialog()
    const { form, optionsOpen } = useSubscriptionForm()
    expect(form.retainAsPublished).toBe(true)
    expect(optionsOpen.value).toBe(false)
  })

  it('saves new subscriptions gray with Retain As Published', async () => {
    const id = await openDialog()
    const { form, submit } = useSubscriptionForm()
    form.topic = 'c/#'
    expect(await submit()).toBe('saved')
    const added = useSubscriptionsStore()
      .list(id)
      .find((sub) => sub.topic === 'c/#')
    expect(added).toMatchObject({ color: NEUTRAL_COLOR, retainAsPublished: true })
  })

  it('adds several filters in the chosen color unless distinct colors are asked for', async () => {
    const id = await openDialog({ multiple: true })
    const state = useSubscriptionForm()
    expect(state.distinctColors.value).toBe(false)
    state.form.lines = 'c/#\nd/#'
    expect(await state.submit()).toBe('saved')
    const colors = useSubscriptionsStore()
      .list(id)
      .filter((sub) => sub.topic === 'c/#' || sub.topic === 'd/#')
      .map((sub) => sub.color)
    expect(colors).toEqual([NEUTRAL_COLOR, NEUTRAL_COLOR])
  })

  it('cycles the palette with "Give each a distinct color"', async () => {
    const id = await openDialog({ multiple: true })
    const state = useSubscriptionForm()
    state.distinctColors.value = true
    state.form.lines = 'c/#\nd/#\ne/#'
    expect(await state.submit()).toBe('saved')
    await settle()
    const colors = useSubscriptionsStore()
      .list(id)
      .filter((sub) => ['c/#', 'd/#', 'e/#'].includes(sub.topic))
      .map((sub) => sub.color)
    // Gray first, then the palette colors the list does not use yet (green and blue are taken).
    expect(colors).toEqual([NEUTRAL_COLOR, PALETTE[3], PALETTE[4]])
  })
})

describe('MQTT 5 option defaults (CT-09)', () => {
  it('counts only a disabled Retain As Published as a custom option', () => {
    expect(hasMqtt5Options(createSubscription({ topic: 'a' }))).toBe(false)
    expect(hasMqtt5Options({ retainAsPublished: false })).toBe(true)
    expect(hasMqtt5Options({ noLocal: true })).toBe(true)
  })

  it('lists Retain As Published in the tooltip only when it is off', () => {
    expect(mqtt5Labels(createSubscription({ topic: 'a' }))).toEqual([])
    expect(mqtt5Labels(createSubscription({ topic: 'a', retainAsPublished: false }))).toEqual([
      'Retain As Published off'
    ])
  })
})
