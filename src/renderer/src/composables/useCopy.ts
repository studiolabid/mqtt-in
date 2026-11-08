/**
 * Clipboard copy with toast feedback: `useCopy().copy(text, label)` for values (topics, payloads,
 * ids, URLs) and `copyCommand(result)` for generated CLI commands (CT-15), which every "Copy as
 * command" entry point shares (palette, subscription rows, messages, publish history).
 */
import { toast } from 'vue-sonner'
import { copiedToast, type CliResult } from '@/utils/cli-command'

/** The success toast of a copy. */
export interface CopyToast {
  title: string
  /** Second line, e.g. what to do before using the copied text. */
  description?: string
}

export interface Copy {
  /**
   * Copies `text` and toasts the outcome: `Copied <label>` for a label ('Copied to clipboard'
   * without one), the given toast for a `CopyToast`, 'Could not copy to the clipboard' on failure.
   *
   * @returns whether the text reached the clipboard.
   */
  copy(text: string, feedback?: string | CopyToast): Promise<boolean>
}

/** Fallback for contexts where the async clipboard API is unavailable or denied. */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.setAttribute('aria-hidden', 'true')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  area.style.pointerEvents = 'none'
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
    active?.focus({ preventScroll: true })
  }
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission denied or window not focused: try the legacy path below.
  }
  return legacyCopy(text)
}

function successToast(feedback: string | CopyToast | undefined): CopyToast {
  if (typeof feedback === 'object') return feedback
  return { title: feedback ? `Copied ${feedback}` : 'Copied to clipboard' }
}

async function copyWithToast(text: string, feedback?: string | CopyToast): Promise<boolean> {
  if (!(await writeClipboard(text))) {
    toast.error('Could not copy to the clipboard')
    return false
  }
  const { title, description } = successToast(feedback)
  if (description) toast.success(title, { description })
  else toast.success(title)
  return true
}

export function useCopy(): Copy {
  return { copy: copyWithToast }
}

/**
 * Copies a generated CLI command: 'Command copied' plus what to know before running it (the
 * password variable to set, a shell caveat such as Windows PowerShell 5.1 dropping the quotes
 * of a JSON payload; `copiedToast`), or 'Could not copy the command' with the reason.
 *
 * @returns whether the command reached the clipboard.
 */
export async function copyCommand(result: CliResult): Promise<boolean> {
  if (!result.ok) {
    toast.error('Could not copy the command', { description: result.error })
    return false
  }
  return copyWithToast(result.command, copiedToast(result))
}
