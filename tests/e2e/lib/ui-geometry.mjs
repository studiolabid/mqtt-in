/**
 * Geometry probes for the ui-* suites: element rectangles, overlaps, toast boxes, the publisher
 * header's controls and main-side window captures in both themes (correct at any zoom factor).
 */
import { join } from 'node:path'
import { capturePage, sleep, tid } from '../kit.mjs'

/** { left, top, right, bottom, width, height } of the first match, or null. */
export const rectOf = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
  }, selector)

/** Height of the first match in CSS px (-1 when missing). */
export const heightOf = async (page, selector) => (await rectOf(page, selector))?.height ?? -1

/** True when two rectangles overlap by more than half a pixel in both directions. */
export const intersects = (a, b) =>
  Boolean(a && b) &&
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5

/** The boxes of every toast on screen. */
export const toastRects = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-sonner-toast]')].map((toast) => {
      const r = toast.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width }
    })
  )

/**
 * The visible action targets toasts must never cover (UX-04): Publish, the payload footer tools
 * (Format / Minify / Template, when the footer shows them), the Connect button and, with the
 * connection dialog open, its footer buttons. { name, left, top, right, bottom }[].
 */
export const actionTargets = (page) =>
  page.evaluate(() => {
    const ids = [
      'publish-button',
      'workspace-connect',
      'connection-cancel',
      'connection-save',
      'connection-save-connect'
    ]
    const boxes = []
    const add = (name, el) => {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || !el.checkVisibility()) return
      boxes.push({ name, left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    }
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="${id}"]`)
      if (el) add(id, el)
    }
    const panel = document.querySelector('[data-testid="publish-panel"]')
    for (const button of panel?.querySelectorAll('button') ?? []) {
      const text = button.textContent?.trim() ?? ''
      const tool = ['Format', 'Minify', 'Template'].find((name) => text.startsWith(name))
      if (tool) add(tool, button)
    }
    return boxes
  })

/**
 * The publisher header row: its visible controls (the part an overflow ancestor does not clip)
 * and every pair that draws over another. Used for the narrow-panel layout (A11Y-07 / FA-02).
 */
export const publisherHeader = (page) =>
  page.evaluate(() => {
    const panel = document.querySelector('[data-testid="publish-panel"]')
    if (!panel) return null
    const p = panel.getBoundingClientRect()
    const candidates = [...panel.querySelectorAll('button, input, [role="combobox"]')].filter(
      (el) => {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0 || !el.checkVisibility()) return false
        return r.top >= p.top - 1 && r.bottom <= p.top + 43
      }
    )
    const controls = candidates.filter((el) => !candidates.some((o) => o !== el && o.contains(el)))
    const boxes = controls.map((el) => {
      const r = el.getBoundingClientRect()
      let left = r.left
      let right = r.right
      for (let node = el.parentElement; node && node !== panel.parentElement; node = node.parentElement) {
        if (getComputedStyle(node).overflowX !== 'visible') {
          const c = node.getBoundingClientRect()
          left = Math.max(left, c.left)
          right = Math.min(right, c.right)
        }
      }
      const name =
        el.getAttribute('data-testid') ||
        el.getAttribute('aria-label') ||
        (el.textContent ?? '').trim().slice(0, 20)
      return { name, left, right, top: r.top, bottom: r.bottom, full: r.width }
    })
    const overlaps = []
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (x > 0.5 && y > 0.5) overlaps.push(`${a.name} × ${b.name} (${x.toFixed(1)} px)`)
      }
    }
    const outside = boxes
      .filter((b) => b.right - b.left > 0 && (b.left < p.left - 0.5 || b.right > p.right + 0.5))
      .map((b) => b.name)
    const publish = boxes.find((b) => b.name === 'publish-button') ?? null
    return { width: p.width, names: boxes.map((b) => b.name), overlaps, outside, publish }
  })

/** Fails unless the publisher header has Publish fully visible and no overlapping controls. */
export async function expectPublisherHeaderFits(page, where) {
  const header = await publisherHeader(page)
  if (!header) throw new Error(`${where}: no publisher panel`)
  if (header.overlaps.length > 0) {
    throw new Error(`${where}: header controls overlap: ${header.overlaps.join('; ')}`)
  }
  if (header.outside.length > 0) {
    throw new Error(`${where}: header controls outside the panel: ${header.outside.join(', ')}`)
  }
  const publish = header.publish
  if (!publish || publish.right - publish.left < publish.full - 0.5) {
    throw new Error(`${where}: Publish is not fully visible (${JSON.stringify(publish)})`)
  }
  return header
}

/** The detail scroller and where the payload's first line sits in it (UX-03 / FD-02). */
export const detailPayloadPlacement = (page) =>
  page.evaluate(() => {
    const detail = document.querySelector('[data-testid="message-detail"]')
    const scroller = detail?.querySelector('.overflow-y-auto')
    const viewer = detail?.querySelector('[data-testid="message-detail-payload"]')
    const line = viewer?.querySelector('.cm-line') ?? viewer
    const s = scroller?.getBoundingClientRect()
    const l = line?.getBoundingClientRect()
    return {
      scrollTop: scroller?.scrollTop ?? null,
      inside: Boolean(s && l && l.height > 0 && l.top >= s.top && l.bottom <= s.bottom),
      lineTop: l ? Math.round(l.top - (s?.top ?? 0)) : null,
      scrollerHeight: s ? Math.round(s.height) : null,
      summary: (
        detail?.querySelector('[data-testid="message-detail-summary"]')?.textContent ?? ''
      )
        .replace(/\s+/g, ' ')
        .trim()
    }
  })

/**
 * Main-side capture (webContents.capturePage, right at any zoom) in both themes: writes
 * <artifacts>/<name>-light.png and -dark.png and restores the theme.
 */
export async function captureWindow(ctx, name) {
  const files = []
  for (let pass = 0; pass < 2; pass++) {
    await ctx.page.mouse.move(1, 1)
    await sleep(300)
    const file = join(ctx.artifacts, `${name}-${(await ctx.isDark()) ? 'dark' : 'light'}.png`)
    files.push(await capturePage(ctx.app, file))
    await ctx.toggleTheme()
  }
  return files
}

/** Screenshot of the page in the current theme only, after the pointer was parked. */
export async function shotNow(ctx, name) {
  await ctx.page.mouse.move(1, 1)
  await sleep(200)
  return ctx.shot(name)
}

/** The selector of a data-testid inside another one. */
export const within = (outer, inner, extra = '') => `${tid(outer)} ${tid(inner, extra)}`
