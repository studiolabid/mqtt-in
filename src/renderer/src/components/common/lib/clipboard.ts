/**
 * Copies text to the system clipboard. Uses the async Clipboard API and falls back to a
 * hidden textarea + `execCommand('copy')` (works even when the clipboard permission is
 * denied by the host). Rejects when both strategies fail.
 */
export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Permission denied or document not focused: try the legacy path below.
    }
  }
  if (!legacyCopy(text)) throw new Error('Clipboard is not available')
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.setAttribute('aria-hidden', 'true')
  area.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;'
  document.body.appendChild(area)
  area.select()
  try {
    return execCopy()
  } finally {
    area.remove()
    previous?.focus({ preventScroll: true })
  }
}

function execCopy(): boolean {
  try {
    return document.execCommand('copy')
  } catch {
    return false
  }
}
