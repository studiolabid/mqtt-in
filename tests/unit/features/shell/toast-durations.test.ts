/**
 * CT-30 / A11Y-21: a toast with an action (Undo, Edit, Show in folder, Reconnect…) must stay at
 * least `ACTION_TOAST_DURATION` (10 s), so a mouse user can read it and a keyboard user can
 * press Alt+T and Tab to the action. The Toaster's default (5 s) is too short for that, so every
 * `toast.*(…)` call whose options carry an `action` must also pass a `duration`.
 *
 * A static scan of the renderer sources: string literals are blanked out before looking for the
 * `action` and `duration` keys, so a toast text never counts as either.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '../../../..')
const RENDERER = join(ROOT, 'src/renderer/src')
/** Generated shadcn-vue components (the Toaster itself lives there). */
const GENERATED = join(RENDERER, 'components/ui')
/**
 * Known offenders owned by another group and reported in a hand-off. Remove an entry once it is
 * fixed; every other file is scanned.
 */
const PENDING = new Set<string>()

const TOAST_CALL = /\btoast(?:\.[a-z]+|\[[^\]]+\])\(/g
const ACTION_KEY = /\baction\b\s*[:,}]/
const DURATION_KEY = /\bduration\s*:/

function sourceFiles(dir: string): string[] {
  if (dir === GENERATED) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(vue|ts)$/.test(name) ? [path] : []
  })
}

/**
 * The argument list of the call whose `(` is at `open`, with the contents of string and
 * template literals replaced by spaces (`${…}` expressions are kept as code).
 */
function callArguments(source: string, open: number): string {
  let out = ''
  let depth = 0
  const templates: number[] = [] // brace depth inside each open `${`
  let quote: string | null = null
  for (let i = open; i < source.length; i++) {
    const char = source[i]
    if (quote) {
      if (char === '\\') {
        out += '  '
        i++
      } else if (quote === '`' && char === '$' && source[i + 1] === '{') {
        templates.push(0)
        quote = null
        out += '${'
        i++
      } else if (char === quote) {
        quote = null
        out += char
      } else out += char === '\n' ? '\n' : ' '
      continue
    }
    if (char === "'" || char === '"' || char === '`') quote = char
    else if (char === '{' && templates.length > 0) templates[templates.length - 1]++
    else if (char === '}' && templates.length > 0) {
      if (templates[templates.length - 1] === 0) {
        templates.pop()
        quote = '`'
      } else templates[templates.length - 1]--
    } else if (char === '(') depth++
    else if (char === ')' && --depth === 0) return out + char
    out += char
  }
  return out
}

/** Offsets of the toast calls in `source` that have an action but no duration. */
function offendingCalls(source: string): number[] {
  const found: number[] = []
  for (const match of source.matchAll(TOAST_CALL)) {
    const open = (match.index ?? 0) + match[0].length - 1
    const args = callArguments(source, open)
    if (ACTION_KEY.test(args) && !DURATION_KEY.test(args)) found.push(open)
  }
  return found
}

/** `path:line` of every offending toast call of a file. */
function offenders(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const path = relative(ROOT, file).split(sep).join('/')
  return offendingCalls(source).map((open) => {
    const line = source.slice(0, open).split('\n').length
    return `${path}:${line}`
  })
}

describe('toasts with an action last ACTION_TOAST_DURATION (CT-30, A11Y-21)', () => {
  it('reads call arguments without the contents of strings', () => {
    const source = "toast.success(`A ${f('x)')} b`, { description: 'action: (', action })"
    expect(callArguments(source, source.indexOf('('))).toBe(
      `(\`  \${f('  ')}  \`, { description: '${' '.repeat(9)}', action })`
    )
  })

  it('flags an action without a duration, and accepts one with', () => {
    expect(offendingCalls("toast.info('a', { action: { label: 'Undo', onClick } })")).toEqual([10])
    expect(offendingCalls("toast[kind]('a', action ? { action, duration: D } : {})")).toEqual([])
    expect(offendingCalls("toast.info('Show action: x', { description: 'action: y' })")).toEqual([])
  })

  it('is enforced in every renderer source file', () => {
    const files = sourceFiles(RENDERER)
    expect(files.length).toBeGreaterThan(100)
    const found = files
      .flatMap(offenders)
      .filter((entry) => !PENDING.has(entry.slice(0, entry.lastIndexOf(':'))))
    expect(found).toEqual([])
  })
})
