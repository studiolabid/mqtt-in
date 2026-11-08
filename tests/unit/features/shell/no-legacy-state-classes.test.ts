/**
 * HEALTH-11: main.css maps `data-open` / `data-closed` / `data-active` onto reka-ui's
 * `data-state` values, and the generated components style state with those variants. An
 * explicit `data-[state=open|closed|active]:` class is redundant, or silently loses to the base
 * class it was meant to override (tailwind-merge only replaces classes of the same variant).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '../../../..')
const FEATURES = ['shell', 'workspace', 'connections', 'subscriptions', 'settings', 'logs'].map(
  (feature) => join(ROOT, 'src/renderer/src/features', feature)
)
const LEGACY = /data-\[state=(open|closed|active)\]/
/** Collapsible content animates with its own keyframes (no shared variant for them). */
const ALLOWED = /animate-collapsible-(up|down)/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(vue|ts)$/.test(name) ? [path] : []
  })
}

describe('no legacy data-[state=…] classes in the app features', () => {
  it('uses the data-open / data-closed / data-active variants', () => {
    const offenders: string[] = []
    for (const file of FEATURES.flatMap(sourceFiles)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (!LEGACY.test(line)) return
          const rest = line.replace(
            /data-\[state=(open|closed)\]:animate-collapsible-(up|down)/g,
            ''
          )
          if (LEGACY.test(rest) || !ALLOWED.test(line)) {
            offenders.push(`${relative(ROOT, file)}:${index + 1}`)
          }
        })
    }
    expect(offenders).toEqual([])
  })
})
