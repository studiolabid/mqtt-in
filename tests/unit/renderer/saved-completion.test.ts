/**
 * Saved messages in the payload editor: when the list opens (a lone word, `/`, Ctrl+Space),
 * what it offers, and that accepting replaces the whole payload and loads the message.
 */
import { describe, expect, it, vi } from 'vitest'
import { CompletionContext, type Completion, type CompletionResult } from '@codemirror/autocomplete'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { savedCompletionSource } from '@/features/publish/utils/saved-completion'
import type { SavedMessage } from '@/types'

function saved(name: string, overrides: Partial<SavedMessage> = {}): SavedMessage {
  return {
    id: name,
    name,
    topic: 'cmd/A00002',
    payload: `{"cmd":"${name}"}`,
    format: 'json',
    qos: 0,
    useTemplate: false,
    properties: { userProperties: [] },
    ...overrides
  }
}

const ITEMS = [saved('reboot'), saved('status'), saved('timer1'), saved('timer5')]

/** Runs the source on `doc` with the cursor at `|` (default: the end). */
function complete(
  doc: string,
  explicit = false,
  pick = vi.fn()
): { result: CompletionResult | null; state: EditorState } {
  const pos = doc.includes('|') ? doc.indexOf('|') : doc.length
  const state = EditorState.create({ doc: doc.replace('|', '') })
  const source = savedCompletionSource({ items: () => ITEMS, pick })
  const result = source(new CompletionContext(state, pos, explicit))
  if (result instanceof Promise) throw new Error('expected a synchronous result')
  return { result, state }
}

const labels = (result: CompletionResult | null): string[] =>
  result?.options.map((option) => option.label) ?? []

describe('savedCompletionSource', () => {
  it('offers names that start with a lone typed word', () => {
    expect(labels(complete('tim').result)).toEqual(['timer1', 'timer5'])
    expect(labels(complete('  STA').result)).toEqual(['status'])
    expect(complete('tim').result?.from).toBe(0)
    expect(complete('xyz').result).toBeNull()
  })

  it('lists everything after / and matches inside names there', () => {
    expect(labels(complete('/').result)).toEqual(['reboot', 'status', 'timer1', 'timer5'])
    // Prefix matches first, then names that contain the word.
    expect(labels(complete('/t').result)).toEqual(['timer1', 'timer5', 'reboot', 'status'])
    expect(complete('/ti').result?.from).toBe(0)
  })

  it('stays closed while editing a real payload, unless asked with Ctrl+Space', () => {
    expect(complete('').result).toBeNull()
    expect(complete('{"cmd": "sta').result).toBeNull()
    expect(complete('sta| more').result).toBeNull()
    const explicit = complete('{"cmd": 1}', true).result
    expect(labels(explicit)).toHaveLength(ITEMS.length)
    expect(labels(complete('', true).result)).toHaveLength(ITEMS.length)
  })

  it('replaces the whole payload and loads the message on accept', () => {
    const pick = vi.fn()
    const { result, state } = complete('tim', false, pick)
    const option: Completion | undefined = result?.options[0]
    if (!option || typeof option.apply !== 'function') throw new Error('no apply function')
    let current = state
    const view = {
      get state() {
        return current
      },
      dispatch: (spec: TransactionSpec) => {
        current = current.update(spec).state
      }
    } as unknown as EditorView
    option.apply(view, option, result?.from ?? 0, 3)
    expect(current.doc.toString()).toBe('{"cmd":"timer1"}')
    expect(pick).toHaveBeenCalledWith(ITEMS[2])
  })

  it('offers nothing without saved messages', () => {
    const source = savedCompletionSource({ items: () => [], pick: vi.fn() })
    const state = EditorState.create({ doc: '/' })
    expect(source(new CompletionContext(state, 1, true))).toBeNull()
  })
})
