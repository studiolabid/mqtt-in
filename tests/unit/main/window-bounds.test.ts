import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WINDOW_SIZE,
  intersects,
  offscreenBounds,
  resolveInitialBounds
} from '../../../src/main/window-bounds'

const primary = { x: 0, y: 0, width: 1920, height: 1040 }
const right = { x: 1920, y: 0, width: 2560, height: 1400 }

describe('window bounds', () => {
  it('detects overlapping rectangles', () => {
    expect(intersects({ x: 10, y: 10, width: 100, height: 100 }, primary)).toBe(true)
    expect(intersects({ x: 1920, y: 0, width: 100, height: 100 }, primary)).toBe(false)
    expect(
      intersects({ x: 1900, y: 0, width: 100, height: 100 }, primary, { width: 50, height: 1 })
    ).toBe(false)
  })

  it('uses the default size without saved state', () => {
    expect(resolveInitialBounds(undefined, [primary])).toEqual({
      bounds: { ...DEFAULT_WINDOW_SIZE },
      maximized: false
    })
  })

  it('restores the saved position when it is still on a display', () => {
    expect(
      resolveInitialBounds({ x: 2000, y: 100, width: 1400, height: 900, maximized: true }, [
        primary,
        right
      ])
    ).toEqual({ bounds: { x: 2000, y: 100, width: 1400, height: 900 }, maximized: true })
  })

  it('drops a position that is off every display (monitor unplugged)', () => {
    expect(
      resolveInitialBounds({ x: 2000, y: 100, width: 1400, height: 900, maximized: false }, [
        primary
      ])
    ).toEqual({ bounds: { width: 1400, height: 900 }, maximized: false })
  })

  it('enforces the minimum size', () => {
    expect(
      resolveInitialBounds({ x: 0, y: 0, width: 300, height: 200, maximized: false }, [primary])
        .bounds
    ).toEqual({ x: 0, y: 0, width: 960, height: 600 })
  })

  it('drops a position whose title bar is above every display (stacked monitor unplugged)', () => {
    const { bounds } = resolveInitialBounds(
      { x: 100, y: -1000, width: 1280, height: 1200, maximized: false },
      [primary]
    )
    expect(bounds.x).toBeUndefined()
    expect(bounds.y).toBeUndefined()
    // The OS centers it on the primary display: it must fit there, title bar included.
    expect(bounds.height).toBeLessThanOrEqual(primary.height)
    expect(bounds).toEqual({ width: 1280, height: 1040 })
  })

  it('keeps a position whose title bar is visible, sized to that display', () => {
    expect(
      resolveInitialBounds({ x: 100, y: 50, width: 1280, height: 1200, maximized: true }, [primary])
    ).toEqual({ bounds: { x: 100, y: 50, width: 1280, height: 1040 }, maximized: true })
  })

  it('needs 120 px and half the height of the title bar on one display', () => {
    const at = (x: number, y: number): boolean => {
      const { bounds } = resolveInitialBounds(
        { x, y, width: 1280, height: 800, maximized: false },
        [primary]
      )
      return bounds.x !== undefined
    }
    expect(at(1920 - 120, 0)).toBe(true)
    expect(at(1920 - 119, 0)).toBe(false)
    expect(at(-1280 + 120, 0)).toBe(true)
    expect(at(-1280 + 119, 0)).toBe(false)
    expect(at(0, -20)).toBe(true)
    expect(at(0, -21)).toBe(false)
    expect(at(0, 1040 - 20)).toBe(true)
    expect(at(0, 1040 - 19)).toBe(false)
  })

  it('drops a window whose body is visible but whose title bar is not', () => {
    // The old check accepted any visible part of the window.
    expect(
      resolveInitialBounds({ x: 0, y: -300, width: 1280, height: 900, maximized: false }, [primary])
        .bounds
    ).toEqual({ width: 1280, height: 900 })
  })

  it('sizes the window to the display that shows its title bar', () => {
    const small = { x: 1920, y: 0, width: 1280, height: 720 }
    expect(
      resolveInitialBounds({ x: 2000, y: 10, width: 1600, height: 1000, maximized: false }, [
        primary,
        small
      ]).bounds
    ).toEqual({ x: 2000, y: 10, width: 1280, height: 720 })
  })

  it('drops a position that narrowing to the display would push off screen', () => {
    // 400 px of the 2400 px title bar are on the display; narrowed to 1920 px, none would be.
    expect(
      resolveInitialBounds({ x: -2000, y: 0, width: 2400, height: 800, maximized: false }, [
        primary
      ]).bounds
    ).toEqual({ width: 1920, height: 800 })
    // Still on screen once narrowed: the position stays.
    expect(
      resolveInitialBounds({ x: -300, y: 0, width: 2400, height: 800, maximized: false }, [primary])
        .bounds
    ).toEqual({ x: -300, y: 0, width: 1920, height: 800 })
  })

  it('never sizes below the minimum, even on a small display', () => {
    const tiny = { x: 0, y: 0, width: 800, height: 560 }
    expect(
      resolveInitialBounds({ x: 0, y: 0, width: 1280, height: 800, maximized: false }, [tiny])
        .bounds
    ).toEqual({ x: 0, y: 0, width: 960, height: 600 })
  })

  it('fits a dropped position to the primary display, not the first one listed', () => {
    const big = { x: -2560, y: 0, width: 2560, height: 1400 }
    expect(
      resolveInitialBounds(
        { x: 5000, y: 5000, width: 2400, height: 1300, maximized: false },
        [big, primary],
        primary
      ).bounds
    ).toEqual({ width: 1920, height: 1040 })
  })

  it('places a background window off every display, at the default size', () => {
    const left = { x: -1280, y: -200, width: 1280, height: 1024 }
    for (const displays of [[primary], [primary, right], [left, primary, right]]) {
      const bounds = offscreenBounds(displays)
      expect(bounds).toMatchObject(DEFAULT_WINDOW_SIZE)
      expect(displays.some((display) => intersects(bounds, display))).toBe(false)
    }
    expect(offscreenBounds([])).toMatchObject(DEFAULT_WINDOW_SIZE)
  })
})
