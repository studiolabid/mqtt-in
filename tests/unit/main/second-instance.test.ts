/**
 * What launching mqtey again does to the running instance, for every combination of state:
 * automated runs never come forward, a quitting instance starts again after quitting (instead of
 * reopening a window the deferred quit would close), otherwise focus or reopen.
 */
import { describe, expect, it } from 'vitest'
import { type SecondInstanceAction, secondInstanceAction } from '../../../src/main/second-instance'

const cases: [background: boolean, quitting: boolean, hasWindow: boolean, SecondInstanceAction][] =
  [
    [true, false, false, 'ignore'],
    [true, false, true, 'ignore'],
    [true, true, false, 'ignore'],
    [true, true, true, 'ignore'],
    [false, true, false, 'relaunch-after-quit'],
    [false, true, true, 'relaunch-after-quit'],
    [false, false, true, 'focus'],
    [false, false, false, 'reopen']
  ]

describe('secondInstanceAction', () => {
  it.each(cases)(
    'background %s, quitting %s, window %s → %s',
    (background, quitting, hasWindow, expected) => {
      expect(secondInstanceAction({ background, quitting, hasWindow })).toBe(expected)
    }
  )

  it('covers every combination once', () => {
    const keys = new Set(cases.map(([b, q, w]) => `${b}${q}${w}`))
    expect(keys.size).toBe(8)
  })
})
