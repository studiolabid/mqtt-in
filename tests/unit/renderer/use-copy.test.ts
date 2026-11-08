import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('vue-sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() })
}))

import { toast } from 'vue-sonner'
import { copyCommand, useCopy } from '@/composables/useCopy'

type WriteText = (text: string) => Promise<void>

function stubClipboard(writeText = vi.fn<WriteText>(async () => undefined)): typeof writeText {
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  return writeText
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
})

describe('useCopy().copy', () => {
  it('toasts "Copied <label>", as before for every existing caller', async () => {
    const writeText = stubClipboard()
    await expect(useCopy().copy('a/b', 'topic')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('a/b')
    expect(toast.success).toHaveBeenCalledWith('Copied topic')
    await useCopy().copy('x')
    expect(toast.success).toHaveBeenLastCalledWith('Copied to clipboard')
  })

  it('takes a custom toast with a description', async () => {
    stubClipboard()
    await useCopy().copy('x', { title: 'Command copied', description: 'Set MQTT_PASSWORD' })
    expect(toast.success).toHaveBeenCalledWith('Command copied', {
      description: 'Set MQTT_PASSWORD'
    })
    await useCopy().copy('y', { title: 'Done' })
    expect(toast.success).toHaveBeenLastCalledWith('Done')
  })

  it('reports a clipboard failure instead of a success', async () => {
    // Denied, and the node test environment has no document for the legacy fallback either.
    stubClipboard(vi.fn<WriteText>(async () => Promise.reject(new Error('denied'))))
    await expect(useCopy().copy('x', 'topic')).resolves.toBe(false)
    expect(toast.error).toHaveBeenCalledWith('Could not copy to the clipboard')
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('copyCommand (CT-15, shared by every "Copy as command" entry point)', () => {
  it('copies the command and says what to know before running it', async () => {
    const writeText = stubClipboard()
    const result = {
      ok: true as const,
      command: 'mosquitto_pub -t a -m "x"',
      passwordVariable: 'MQTT_PASSWORD',
      warning: 'Needs PowerShell 7.3 or later'
    }
    await expect(copyCommand(result)).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith(result.command)
    expect(toast.success).toHaveBeenCalledWith('Command copied', {
      description: expect.stringMatching(/MQTT_PASSWORD.*PowerShell 7\.3/)
    })
  })

  it('copies nothing for a command the generator refused', async () => {
    const writeText = stubClipboard()
    await expect(copyCommand({ ok: false, error: 'Binary payloads cannot…' })).resolves.toBe(false)
    expect(writeText).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Could not copy the command', {
      description: 'Binary payloads cannot…'
    })
  })
})
