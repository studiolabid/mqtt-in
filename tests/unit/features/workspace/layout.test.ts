import { describe, expect, it } from 'vitest'
import {
  initialPublishHeight,
  isPublisherCollapsed,
  MESSAGES_MIN_HEIGHT,
  PUBLISH_HEIGHT,
  publisherHeightFor,
  WINDOW_CHROME_HEIGHT
} from '@/features/workspace/utils/layout'

describe('isPublisherCollapsed (UX-01)', () => {
  it.each([
    [40, true],
    // reka-ui reports pixel sizes with floating-point noise.
    [40.000000001, true],
    [41, true],
    [42, false],
    [150, false]
  ])('%d px → %s', (size, collapsed) => {
    expect(isPublisherCollapsed(size)).toBe(collapsed)
  })
})

describe('publisherHeightFor (A11Y-07)', () => {
  it('keeps the remembered height while it fits', () => {
    // 45 % of 600 is 270: a 264 px publisher stays as it is.
    expect(publisherHeightFor(600, 264)).toBe(264)
  })

  it('caps the publisher at 45 % of the panels', () => {
    expect(publisherHeightFor(600, 400)).toBe(270)
    expect(publisherHeightFor(1000, 900)).toBe(450)
  })

  it('leaves the messages their minimum room', () => {
    // 45 % of 360 is 162, but the messages need 200 px (+ 1 px handle).
    expect(publisherHeightFor(360, 264)).toBe(360 - MESSAGES_MIN_HEIGHT - 1)
  })

  it('never opens below the publisher minimum', () => {
    expect(publisherHeightFor(800, 20)).toBe(PUBLISH_HEIGHT.min)
    expect(publisherHeightFor(351, 264)).toBe(PUBLISH_HEIGHT.min)
  })

  it('collapses when the panels cannot hold both minimums', () => {
    expect(publisherHeightFor(350, 264)).toBe('collapsed')
    // 200 % zoom of a 1280×800 window: 400 - 116 px of chrome.
    expect(publisherHeightFor(284, 264)).toBe('collapsed')
    expect(publisherHeightFor(0, 264)).toBe('collapsed')
    expect(publisherHeightFor(Number.NaN, 264)).toBe('collapsed')
  })

  it('leaves at least two message rows at 150 % zoom', () => {
    // 1280×800 at 150 %: 533 CSS px high, minus the window chrome.
    const group = Math.floor(800 / 1.5) - WINDOW_CHROME_HEIGHT
    const height = publisherHeightFor(group, PUBLISH_HEIGHT.default)
    expect(height).not.toBe('collapsed')
    // The message list is the messages panel minus the tab bar and toolbar (80 px).
    expect(group - Number(height) - 1 - 80).toBeGreaterThanOrEqual(104)
  })

  it('falls back to the default height for a broken remembered value', () => {
    expect(publisherHeightFor(800, Number.NaN)).toBe(PUBLISH_HEIGHT.default)
  })
})

describe('initialPublishHeight', () => {
  it('fits the remembered height to the window before the panels are measured', () => {
    expect(initialPublishHeight(264, 800)).toBe(264)
    expect(initialPublishHeight(600, 800)).toBe(Math.round((800 - WINDOW_CHROME_HEIGHT) * 0.45))
    expect(initialPublishHeight(264, 400)).toBe('collapsed')
  })
})
