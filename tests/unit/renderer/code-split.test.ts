import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { routes } from '@/router/routes'
import { CodeEditor, PayloadDiff, TimeSeriesChart } from '@/components/common/async'

// The welcome screen is the only statically imported route (the test runner compiles no SFCs).
vi.mock('@/features/shell/WelcomeView.vue', () => ({ default: { name: 'WelcomeView' } }))

const read = (path: string): string =>
  readFileSync(new URL(`../../../src/renderer/src/${path}`, import.meta.url), 'utf8')

describe('renderer code splitting (PKG-07, CT-20)', () => {
  it('loads the workspace and settings routes lazily', () => {
    const byName = new Map(routes.map((route) => [route.name, route]))
    for (const name of ['connection', 'settings']) {
      const route = byName.get(name)
      expect(route && 'component' in route ? typeof route.component : 'missing', name).toBe(
        'function'
      )
    }
    const welcome = byName.get('welcome')
    expect(welcome && 'component' in welcome ? welcome.component : null).toEqual({
      name: 'WelcomeView'
    })
  })

  it('exports the heavy common components as async components', () => {
    for (const component of [CodeEditor, TimeSeriesChart, PayloadDiff]) {
      expect(component).toHaveProperty('__asyncLoader')
      expect(typeof (component as { __asyncLoader?: unknown }).__asyncLoader).toBe('function')
    }
  })

  it('never imports CodeMirror, uPlot or the diff statically from the barrel or the router', () => {
    const barrel = read('components/common/index.ts')
    expect(barrel).toContain("export { CodeEditor, PayloadDiff, TimeSeriesChart } from './async'")
    expect(barrel).not.toMatch(/from '\.\/(CodeEditor|TimeSeriesChart|PayloadDiff)\.vue'/)
    expect(read('components/common/PayloadView.vue')).not.toContain("from './CodeEditor.vue'")
    const router = read('router/index.ts') + read('router/routes.ts')
    expect(router).not.toMatch(/import \w+ from '@\/features\/(workspace|settings)\//)
  })
})
