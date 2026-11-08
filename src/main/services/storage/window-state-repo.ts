/**
 * Persisted main-window geometry (`window-state.json`).
 */
import { z } from 'zod'
import type { JsonFile } from './json-file'

export interface WindowState {
  /** Normal (un-maximized) bounds. `x` / `y` are absent when the window was never moved. */
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

const coordinate = z.number().int().min(-1_000_000).max(1_000_000)
const size = z.number().int().min(100).max(100_000)

const windowStateSchema = z.object({
  x: coordinate.optional(),
  y: coordinate.optional(),
  width: size,
  height: size,
  maximized: z.boolean()
})

/** Invalid content is treated as "no saved state" (never as a corrupt file). */
function parseWindowState(raw: unknown): WindowState | null {
  const result = windowStateSchema.safeParse(raw)
  return result.success ? result.data : null
}

export class WindowStateRepo {
  constructor(private readonly file: JsonFile<WindowState | null>) {
    file.load(null, parseWindowState)
  }

  get(): WindowState | undefined {
    const state = this.file.get()
    return state ? { ...state } : undefined
  }

  /** Saves the state (rounded; ignored when invalid, e.g. a minimized 0×0 window). */
  set(state: WindowState): void {
    const next = parseWindowState({
      ...state,
      x: state.x === undefined ? undefined : Math.round(state.x),
      y: state.y === undefined ? undefined : Math.round(state.y),
      width: Math.round(state.width),
      height: Math.round(state.height)
    })
    if (next) this.file.set(next)
  }
}
