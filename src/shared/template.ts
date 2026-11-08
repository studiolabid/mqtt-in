/**
 * Tiny payload template engine used for single and repeat publishing.
 *
 *   {"t": {{random(20,30)}}, "id": "{{uuid}}", "n": {{counter}}, "at": "{{iso}}"}
 *
 * Unknown tokens are left untouched so arbitrary `{{...}}` text is safe.
 */

export interface TemplateContext {
  /** 1-based message number (repeat publishing increments it). */
  counter: number
  /** Override "now" (epoch ms) — useful for tests. */
  now?: number
  /** Override the random source (0 <= x < 1) — useful for tests. */
  random?: () => number
}

export interface TemplateVariable {
  token: string
  description: string
}

export const TEMPLATE_VARIABLES: TemplateVariable[] = [
  { token: '{{timestamp}}', description: 'Epoch milliseconds' },
  { token: '{{unix}}', description: 'Epoch seconds' },
  { token: '{{iso}}', description: 'ISO-8601 date & time (UTC)' },
  { token: '{{date}}', description: 'Local date, YYYY-MM-DD' },
  { token: '{{time}}', description: 'Local time, HH:mm:ss' },
  { token: '{{uuid}}', description: 'Random UUID v4' },
  { token: '{{counter}}', description: 'Message number: 1, 2, 3…' },
  { token: '{{random}}', description: 'Random float between 0 and 1' },
  {
    token: '{{random(20,30)}}',
    description: 'Random float in range (2 decimals, optional 3rd arg)'
  },
  { token: '{{randomInt(1,100)}}', description: 'Random integer in range (inclusive)' },
  { token: '{{pick(on,off)}}', description: 'Random item from a list' },
  { token: '{{bool}}', description: 'Random true / false' }
]

/**
 * `{{ name }}` or `{{ name(args) }}`. Matching is linear in the text length (it runs on the main
 * process at repeat start and in every repeat tick): only one `\s*` can take the spaces before
 * `}}`, and the arguments stop at the next `{{`, so an unclosed `{{a` or `{{a(` followed by
 * a long tail cannot backtrack quadratically. Arguments therefore never contain `{{`.
 */
const TOKEN_RE = /\{\{\s*([A-Za-z]+)\s*(?:\(((?:(?!\{\{)[^)])*)\)\s*)?\}\}/g

const KNOWN = new Set([
  'timestamp',
  'unix',
  'iso',
  'date',
  'time',
  'uuid',
  'counter',
  'random',
  'randomInt',
  'pick',
  'bool'
])

/** True when the text contains at least one known template token. */
export function hasTemplate(text: string): boolean {
  for (const match of text.matchAll(TOKEN_RE)) {
    if (KNOWN.has(match[1])) return true
  }
  return false
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

function parseArgs(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim().replace(/^(['"])(.*)\1$/, '$2'))
    .filter((s) => s.length > 0)
}

export function renderTemplate(text: string, ctx: TemplateContext): string {
  if (!text.includes('{{')) return text
  const now = ctx.now ?? Date.now()
  const rand = ctx.random ?? Math.random
  const date = new Date(now)

  return text.replace(TOKEN_RE, (whole, name: string, rawArgs: string | undefined) => {
    const args = parseArgs(rawArgs)
    switch (name) {
      case 'timestamp':
        return String(now)
      case 'unix':
        return String(Math.floor(now / 1000))
      case 'iso':
        return date.toISOString()
      case 'date':
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      case 'time':
        return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
      case 'uuid':
        return globalThis.crypto.randomUUID()
      case 'counter':
        return String(ctx.counter)
      case 'random': {
        if (args.length < 2) return String(Number(rand().toFixed(4)))
        const min = Number(args[0])
        const max = Number(args[1])
        const decimals = args[2] !== undefined ? Math.max(0, Math.min(10, Number(args[2]))) : 2
        if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(decimals)) {
          return whole
        }
        return (min + rand() * (max - min)).toFixed(decimals)
      }
      case 'randomInt': {
        const min = Math.ceil(Number(args[0] ?? 0))
        const max = Math.floor(Number(args[1] ?? 100))
        if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return whole
        return String(min + Math.floor(rand() * (max - min + 1)))
      }
      case 'pick':
        return args.length === 0 ? whole : args[Math.floor(rand() * args.length)]
      case 'bool':
        return rand() < 0.5 ? 'true' : 'false'
      default:
        return whole
    }
  })
}
