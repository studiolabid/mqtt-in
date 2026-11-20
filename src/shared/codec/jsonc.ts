/**
 * Authored JSON with line comments (`//` or `#`) and trailing commas (JSONC, as in Sublime Text or
 * VS Code settings). Ctrl+/ in the payload editor comments lines out; what is published is plain
 * JSON without them. Only line comments are supported: JSON strings cannot span lines, so a
 * comment can always be found on its own line (the editor greys them out line by line).
 */
import {
  CLOSE_BRACE,
  CLOSE_BRACKET,
  COLON,
  COMMA,
  endOfJsonString,
  isJsonLiteralChar,
  isJsonWhitespace,
  OPEN_BRACE,
  OPEN_BRACKET,
  QUOTE,
  tryParseJson
} from './json'
import { PayloadError } from './errors'

const SLASH = 0x2f
const HASH = 0x23
const LF = 0x0a
const CR = 0x0d
const SPACE = 0x20
const TAB = 0x09

/** A line comment (`//` or `#`) starts at `i`. Neither can start a JSON token. */
function isLineCommentAt(text: string, i: number): boolean {
  const code = text.charCodeAt(i)
  return code === HASH || (code === SLASH && text.charCodeAt(i + 1) === SLASH)
}

/** Index of the line break (or the end) that ends the line comment starting at `start`. */
function endOfLineComment(text: string, start: number): number {
  let i = start + 1
  while (i < text.length) {
    const code = text.charCodeAt(i)
    if (code === LF || code === CR) return i
    i++
  }
  return text.length
}

/** Index of the next character that is neither whitespace nor inside a line comment. */
function nextSignificant(text: string, from: number): number {
  let i = from
  while (i < text.length) {
    if (isJsonWhitespace(text.charCodeAt(i))) i++
    else if (isLineCommentAt(text, i)) i = endOfLineComment(text, i)
    else return i
  }
  return i
}

/** The comma at `i` is followed by `}` or `]` (comments and whitespace skipped). */
function isFollowedByClose(text: string, i: number): boolean {
  const next = text.charCodeAt(nextSignificant(text, i + 1))
  return next === CLOSE_BRACE || next === CLOSE_BRACKET
}

/** A comma after `prev` would follow a value (not `[,` `{,` `,,` `:,` or a leading comma). */
function endsValue(prev: number): boolean {
  return (
    prev !== 0 && prev !== OPEN_BRACE && prev !== OPEN_BRACKET && prev !== COMMA && prev !== COLON
  )
}

/**
 * Where the `//` or `#` comment of one line starts (strings skipped), or -1. JSON strings never span
 * lines, so a line can be checked on its own.
 */
export function jsonLineCommentStart(line: string): number {
  let i = 0
  while (i < line.length) {
    const code = line.charCodeAt(i)
    if (code === QUOTE) {
      i = endOfJsonString(line, i)
    } else if (isLineCommentAt(line, i)) {
      return i
    } else {
      i++
    }
  }
  return -1
}

/**
 * Plain JSON from JSONC: `//` / `#` comments and trailing commas removed. A comment on a line of its
 * own goes with its line; one after a value keeps the line break. Returns `text` itself when
 * there is nothing to remove, so `stripJsonComments(t) === t` tells whether it had any.
 */
export function stripJsonComments(text: string): string {
  let out = ''
  let changed = false
  let i = 0
  let run = 0 // start of the text not copied yet
  let prev = 0 // last significant character (comments and whitespace skipped)
  while (i < text.length) {
    const code = text.charCodeAt(i)
    if (code === QUOTE) {
      i = endOfJsonString(text, i)
      prev = QUOTE
    } else if (isLineCommentAt(text, i)) {
      out += text.slice(run, i)
      changed = true
      // Drop the blanks before the comment; a whole-line comment takes its line break too.
      let keep = out.length
      while (keep > 0 && (out.charCodeAt(keep - 1) === SPACE || out.charCodeAt(keep - 1) === TAB)) {
        keep--
      }
      const ownLine = keep === 0 || out.charCodeAt(keep - 1) === LF
      out = out.slice(0, keep)
      i = endOfLineComment(text, i)
      if (ownLine) {
        if (text.charCodeAt(i) === CR) i++
        if (text.charCodeAt(i) === LF) i++
      }
      run = i
    } else if (code === COMMA && endsValue(prev) && isFollowedByClose(text, i)) {
      out += text.slice(run, i)
      changed = true
      i++
      run = i
    } else {
      if (!isJsonWhitespace(code)) prev = code
      i++
    }
  }
  return changed ? out + text.slice(run) : text
}

/**
 * Pretty prints JSONC (`indent` spaces), keeping `//` / `#` comments where they were: on a line of their
 * own, or after the value they followed. Trailing commas are dropped. Values are copied exactly
 * as written (see `reindentJson`).
 *
 * @throws PayloadError when the text without its comments is not valid JSON.
 */
export function formatJsonc(text: string, indent = 2): string {
  const parsed = tryParseJson(stripJsonComments(text))
  if (!parsed.ok) throw new PayloadError(`Invalid JSON: ${parsed.error}`)
  const unit = ' '.repeat(Math.min(10, Math.max(1, Math.floor(indent))))
  let out = ''
  let depth = 0
  /** The next token starts a new line. */
  let needBreak = false
  /** The last thing written is a line comment: nothing may follow on its line. */
  let afterComment = false
  /** A line break was crossed in the source since the last token. */
  let sourceBreak = true

  const newline = (): void => {
    if (out.length > 0) out += `\n${unit.repeat(depth)}`
    needBreak = false
    afterComment = false
  }
  const startToken = (): void => {
    if (needBreak || afterComment) newline()
    sourceBreak = false
  }

  let i = 0
  while (i < text.length) {
    const code = text.charCodeAt(i)
    if (isJsonWhitespace(code)) {
      if (code === LF || code === CR) sourceBreak = true
      i++
    } else if (isLineCommentAt(text, i)) {
      const end = endOfLineComment(text, i)
      const comment = text.slice(i, end).trimEnd()
      if (out.length > 0 && !sourceBreak && !afterComment) out += ` ${comment}`
      else {
        newline()
        out += comment
      }
      needBreak = true
      afterComment = true
      sourceBreak = false
      i = end
    } else if (code === QUOTE) {
      startToken()
      const end = endOfJsonString(text, i)
      out += text.slice(i, end)
      i = end
    } else if (code === OPEN_BRACE || code === OPEN_BRACKET) {
      startToken()
      const close = code === OPEN_BRACE ? CLOSE_BRACE : CLOSE_BRACKET
      let next = i + 1
      while (isJsonWhitespace(text.charCodeAt(next))) next++
      if (text.charCodeAt(next) === close) {
        out += text[i] + text[next] // empty container stays on one line
        i = next + 1
      } else {
        out += text[i]
        depth++
        needBreak = true
        i++
      }
    } else if (code === CLOSE_BRACE || code === CLOSE_BRACKET) {
      depth--
      newline()
      sourceBreak = false
      out += text[i]
      i++
    } else if (code === COMMA) {
      // Validated above, so a comma before `}` / `]` is a trailing comma after a value.
      if (!isFollowedByClose(text, i)) {
        if (afterComment) newline()
        out += ','
        needBreak = true
      }
      sourceBreak = false
      i++
    } else if (code === COLON) {
      if (afterComment) newline()
      out += ': '
      sourceBreak = false
      i++
    } else {
      // number / true / false / null: copy the whole literal at once
      startToken()
      let end = i + 1
      while (end < text.length && isJsonLiteralChar(text.charCodeAt(end))) end++
      out += text.slice(i, end)
      i = end
    }
  }
  return out
}
