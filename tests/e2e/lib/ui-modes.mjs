/**
 * Probes for display modes and visual states (suites/ui-modes.mjs): text-field borders and focus
 * rings, running 'enter' animations, and text drawn in the raw accent colour.
 */
import { sleep, tid } from '../kit.mjs'
import { keyboardFocus, openPalette, showTab } from './ui.mjs'

/** A box-shadow layer that draws a ring: a visible colour with a spread of at least 1 px. */
const RING =
  /(rgba?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|color\([^)]*\)|#[0-9a-f]+)\s+0px 0px 0px ([1-9]\d*(?:\.\d+)?)px/gi
const TRANSPARENT = /^rgba\(0, 0, 0, 0\)$|^transparent$|\/ 0\)$/

/**
 * The idle border colour and the focused box-shadow of a text field (`locator`, an input), or of
 * its wrapper (`wrapper`: a selector such as '[data-slot="input-group"]'). `ring` is the visible
 * ring layer of the focused shadow ('colour spread'), '' when there is none.
 */
export async function fieldStyles(page, locator, wrapper = null) {
  const read = () =>
    locator.evaluate((el, selector) => {
      const box = selector ? el.closest(selector) : el
      const style = getComputedStyle(box)
      return { border: style.borderTopColor, shadow: style.boxShadow }
    }, wrapper)
  await page.evaluate(
    () => document.activeElement instanceof HTMLElement && document.activeElement.blur()
  )
  await page.mouse.move(1, 1)
  await sleep(250)
  const idle = await read()
  await keyboardFocus(page, locator)
  await sleep(250) // border colours transition
  const focus = await read()
  const rings = [...focus.shadow.matchAll(RING)].filter(([, color]) => !TRANSPARENT.test(color))
  const ring = rings.map(([, color, spread]) => `${color} ${spread}`).join(', ')
  return {
    border: idle.border,
    focused: focus.shadow,
    focusBorder: focus.border,
    ring,
    visible: ring !== ''
  }
}

/** True for a colour drawn with partial alpha ('oklch(… / 0.5)', 'rgba(…, 0.5)'). */
const translucent = (color) =>
  /\/\s*0?\.\d+\)$/.test(color) || /^rgba\([^)]*,\s*0?\.\d+\)$/.test(color)

/**
 * The focus indicator of `locator` after a keyboard focus: its ring layers ('colour spread') and
 * outline, and whether every visible ring is full strength (ARCHITECTURE §5: ring-ring, never
 * ring-ring/50).
 */
export async function focusRing(page, locator) {
  await keyboardFocus(page, locator)
  await sleep(250)
  const style = await locator.evaluate((el) => {
    const s = getComputedStyle(el)
    return { shadow: s.boxShadow, outline: `${s.outlineStyle} ${s.outlineColor}` }
  })
  const rings = [...style.shadow.matchAll(RING)].filter(([, color]) => !TRANSPARENT.test(color))
  return {
    rings: rings.map(([, color, spread]) => `${color} ${spread}px`),
    outline: style.outline,
    fullStrength: rings.length > 0 && rings.every(([, color]) => !translucent(color))
  }
}

/**
 * The most 'enter' animations seen running over three frames, after `delayMs` (0: right after
 * the click that opens a dialog).
 */
export const runningEnterAnimations = (page, delayMs = 0) =>
  page.evaluate(async (delay) => {
    if (delay > 0) await new Promise((done) => setTimeout(done, delay))
    let most = 0
    for (let frame = 0; frame < 3; frame++) {
      const running = document
        .getAnimations()
        .filter((a) => a.playState === 'running' && a.animationName === 'enter').length
      most = Math.max(most, running)
      await new Promise((done) => requestAnimationFrame(done))
    }
    return most
  }, delayMs)

/**
 * Records the durations (s) of the 'enter' animations started while `action` runs (an
 * animationstart listener, so no timing window can miss one). Resolves the list.
 */
export async function enterAnimationDurations(page, action) {
  await page.evaluate(() => {
    const seen = (window.__enterAnimations = [])
    window.__onEnter = (event) => {
      if (event.animationName !== 'enter') return
      seen.push(parseFloat(getComputedStyle(event.target).animationDuration) || 0)
    }
    document.addEventListener('animationstart', window.__onEnter, true)
  })
  try {
    await action()
    await sleep(250)
    return await page.evaluate(() => window.__enterAnimations.slice())
  } finally {
    await page.evaluate(() =>
      document.removeEventListener('animationstart', window.__onEnter, true)
    )
  }
}

/**
 * Visible elements whose own text is drawn in the raw --primary colour while the accent has a
 * separate, contrast-safe --primary-text shade ('tag[testid or class] "text"'). [] when the two
 * tokens are equal (nothing to tell apart).
 */
export const rawAccentText = (page) =>
  page.evaluate(() => {
    const colorOf = (value) => {
      const probe = document.createElement('span')
      probe.style.color = value
      document.body.append(probe)
      const color = getComputedStyle(probe).color
      probe.remove()
      return color
    }
    const primary = colorOf('var(--primary)')
    if (primary === colorOf('var(--primary-text)')) return []
    const found = []
    for (const el of document.querySelectorAll('body *')) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '')
      if (!own || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
      if (getComputedStyle(el).color !== primary) continue
      const id =
        el.getAttribute('data-testid') ?? String(el.getAttribute('class') ?? '').slice(0, 80)
      found.push(`${el.tagName.toLowerCase()}[${id}] "${el.textContent.trim().slice(0, 30)}"`)
    }
    return found
  })

async function pickAccent(ctx, accent) {
  await ctx.click('open-settings')
  await ctx.waitForTestId('settings')
  await ctx.click(`settings-accent-${accent}`)
  await ctx.page.waitForFunction(
    (value) => document.documentElement.dataset.accent === value,
    accent
  )
}

/**
 * Switches to `accent` and looks for raw accent text in Settings, the workspace views (a wildcard
 * topic filter, Topics, Logs), the palette, the template variables popover and the repeat dialog.
 * Puts Mono back afterwards. Resolves { checked: views scanned, offenders: 'view: element' }.
 */
export async function accentTextScan(ctx, accent) {
  const { page } = ctx
  const offenders = []
  let checked = 0
  const scan = async (view) => {
    await sleep(200)
    checked += 1
    for (const found of await rawAccentText(page)) offenders.push(`${view}: ${found}`)
  }
  await pickAccent(ctx, accent)
  // The scan must see raw accent text when there is some (a planted probe), or it proves nothing.
  const planted = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.textContent = 'e2e accent probe'
    probe.style.cssText = 'color: var(--primary); position: fixed; top: 0; left: 0'
    document.body.append(probe)
    return probe.isConnected
  })
  const seen =
    planted && (await rawAccentText(page)).some((text) => text.includes('e2e accent probe'))
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('span')) {
      if (el.textContent === 'e2e accent probe') el.remove()
    }
  })
  if (!seen) throw new Error(`the accent scan misses raw --primary text (${accent})`)
  await scan('settings')
  await ctx.click('settings-back')
  await ctx.waitForTestId('workspace')
  await showTab(ctx, 'messages')
  await scan('messages')
  await ctx.fill('message-topic-filter', 'e2e/+/x')
  await scan('topic filter with a wildcard')
  await ctx.fill('message-topic-filter', '')
  await page.keyboard.press('Escape')
  await showTab(ctx, 'topics')
  await scan('topics')
  await showTab(ctx, 'logs')
  await scan('logs')
  await showTab(ctx, 'messages')
  await openPalette(ctx)
  await scan('palette')
  await ctx.pressEscapeUntilHidden('command-palette')
  await page.locator(`${tid('publish-panel')} button[aria-label="Template variables"]`).click()
  await page
    .locator(
      '[role="dialog"][aria-label="Template variables"], [aria-label="Template variables"][data-state="open"]'
    )
    .first()
    .waitFor()
  await scan('template variables')
  await page.keyboard.press('Escape')
  await ctx.click('publish-repeat')
  await ctx.waitForTestId('publish-repeat-start')
  await scan('repeat dialog')
  await page.keyboard.press('Escape')
  await ctx.waitForTestId('publish-repeat-start', { state: 'hidden' })
  await pickAccent(ctx, 'zinc')
  await ctx.click('settings-back')
  await ctx.waitForTestId('workspace')
  await page.mouse.move(1, 1)
  return { checked, offenders }
}
