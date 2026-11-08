import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ACTION_TOAST_DURATION,
  DEFAULT_TOAST_DURATION,
  STATUS_BAR_HEIGHT,
  STICKY_TOAST_DURATION,
  TOAST_WIDTH,
  TOASTER_OFFSET,
  toastDuration,
  VISIBLE_TOASTS
} from '@/lib/toast-options'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('toast options (CT-30, A11Y-21, UX-04)', () => {
  it('keeps plain toasts 5 s and toasts with an action at least 10 s', () => {
    expect(DEFAULT_TOAST_DURATION).toBe(5_000)
    expect(ACTION_TOAST_DURATION).toBeGreaterThanOrEqual(10_000)
    expect(ACTION_TOAST_DURATION).toBe(10_000)
    expect(STICKY_TOAST_DURATION).toBe(Number.POSITIVE_INFINITY)
    expect(toastDuration({})).toBe(DEFAULT_TOAST_DURATION)
    expect(toastDuration({ action: { label: 'Undo', onClick: () => undefined } })).toBe(
      ACTION_TOAST_DURATION
    )
  })

  it('places toasts bottom left above the status bar, narrow and at most 3 at once', () => {
    expect(TOASTER_OFFSET.bottom).toBeGreaterThan(STATUS_BAR_HEIGHT)
    expect(TOASTER_OFFSET).toEqual({ bottom: 36, left: 12 })
    expect(TOAST_WIDTH).toBeLessThanOrEqual(340)
    expect(VISIBLE_TOASTS).toBe(3)
    const app = read('../../../src/renderer/src/App.vue')
    expect(app).toContain('position="bottom-left"')
    expect(app).toContain(':offset="TOASTER_OFFSET"')
    expect(app).toContain(':duration="DEFAULT_TOAST_DURATION"')
    expect(app).toContain('close-button')
    expect(read('../../../src/renderer/src/components/ui/sonner/Sonner.vue')).toContain(
      "'--width': `${TOAST_WIDTH}px`"
    )
  })

  it('shows the focus of the toast list (Alt+T)', () => {
    const css = read('../../../src/renderer/src/assets/main.css')
    expect(css).toMatch(/\[data-sonner-toaster\]:focus \[data-sonner-toast\] \{[^}]*outline/)
  })
})
