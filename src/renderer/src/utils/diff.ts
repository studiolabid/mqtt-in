/**
 * Line diff between two payload texts, folding and line numbers for display (pure, no Vue).
 */
import { diffLines } from 'diff'

export type DiffLineKind = 'added' | 'removed' | 'unchanged'

export interface DiffLine {
  kind: DiffLineKind
  /** Line content without the line break. */
  text: string
}

export interface LineDiffOptions {
  /**
   * Give up after this many milliseconds and report "everything removed, everything added"
   * instead of freezing the UI on huge, very different texts. Default 250.
   */
  timeoutMs?: number
}

/**
 * Line-by-line diff from `previous` to `next`. Trailing line breaks and CRLF vs LF differences
 * are ignored. Each returned entry is a single line.
 */
export function lineDiff(
  previous: string,
  next: string,
  options: LineDiffOptions = {}
): DiffLine[] {
  if (previous === next) return toLines(previous).map((text) => ({ kind: 'unchanged', text }))

  const changes = diffLines(previous, next, {
    timeout: options.timeoutMs ?? 250,
    ignoreNewlineAtEof: true,
    stripTrailingCr: true
  })
  if (!changes) {
    return [
      ...toLines(previous).map((text): DiffLine => ({ kind: 'removed', text })),
      ...toLines(next).map((text): DiffLine => ({ kind: 'added', text }))
    ]
  }

  const out: DiffLine[] = []
  for (const change of changes) {
    const kind: DiffLineKind = change.added ? 'added' : change.removed ? 'removed' : 'unchanged'
    for (const text of toLines(change.value)) out.push({ kind, text })
  }
  return out
}

/** Number of added and removed lines of a diff. */
export function diffSummary(lines: readonly DiffLine[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.kind === 'added') added++
    else if (line.kind === 'removed') removed++
  }
  return { added, removed }
}

export type DiffBlock =
  | { kind: 'lines'; key: number; lines: readonly DiffLine[] }
  | { kind: 'fold'; key: number; lines: readonly DiffLine[] }

export interface FoldOptions {
  /** Unchanged lines kept visible around every change. Default 3. */
  context?: number
  /** Shorter unchanged runs are not folded. Default 6. */
  minFold?: number
}

/**
 * Groups diff lines into visible blocks and folds of unchanged lines that are further than
 * `context` lines away from any change. `key` is the index of the block's first line.
 */
export function foldDiff(lines: readonly DiffLine[], options: FoldOptions = {}): DiffBlock[] {
  const context = Math.max(0, options.context ?? 3)
  const minFold = Math.max(1, options.minFold ?? 6)

  const visible = new Uint8Array(lines.length)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind === 'unchanged') continue
    const from = Math.max(0, i - context)
    const to = Math.min(lines.length - 1, i + context)
    for (let j = from; j <= to; j++) visible[j] = 1
  }

  const blocks: DiffBlock[] = []
  let i = 0
  while (i < lines.length) {
    const shown = visible[i] === 1
    let end = i
    while (end < lines.length && (visible[end] === 1) === shown) end++
    const run = lines.slice(i, end)
    if (shown || run.length < minFold) {
      const previous = blocks[blocks.length - 1]
      if (previous?.kind === 'lines') {
        blocks[blocks.length - 1] = { ...previous, lines: previous.lines.concat(run) }
      } else blocks.push({ kind: 'lines', key: i, lines: run })
    } else blocks.push({ kind: 'fold', key: i, lines: run })
    i = end
  }
  return blocks
}

/**
 * Display line numbers of a diff: removed lines count in the previous text, added and
 * unchanged lines in the new one.
 */
export function diffLineNumbers(lines: readonly DiffLine[]): Uint32Array {
  const numbers = new Uint32Array(lines.length)
  let before = 0
  let after = 0
  for (let i = 0; i < lines.length; i++) {
    const kind = lines[i].kind
    if (kind !== 'added') before++
    if (kind !== 'removed') after++
    numbers[i] = kind === 'removed' ? before : after
  }
  return numbers
}

function toLines(text: string): string[] {
  if (text.length === 0) return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
}
