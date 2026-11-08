/**
 * IN-02 and the single-instance user decision: a file-mode launch (`electron out-*\/main/index.js`)
 * runs with the mqtey identity (name, package.json version) on the profile it was given; a second
 * launch on the same profile quits with code 0 and leaves the first with one window; and
 * MQTEY_E2E=1 without MQTEY_USER_DATA_DIR refuses to start (exit code 2) and writes nothing.
 * The second and the guarded launches are plain processes that quit on their own (spawnApp); the
 * guarded one is contained (contain-profile.cjs), so it can never reach the real profile.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createProfile, MAIN, removeProfile, ROOT, spawnApp } from '../kit.mjs'
import { expect } from '../lib/platform.mjs'
import { AUTOMATION_TITLE } from '../lib/platform-window.mjs'

const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
const samePath = (a, b) => {
  const norm = (path) => resolve(path)[process.platform === 'win32' ? 'toLowerCase' : 'toString']()
  return norm(a) === norm(b)
}
/** A spawned launch must quit by itself well within this (it fails when it stays alive). */
const QUIT_TIMEOUT = 15_000

export default {
  name: 'platform-identity',
  order: 21,

  async run(ctx) {
    const { step, log } = ctx

    await step('a file-mode launch runs as mqtey on its own profile', async () => {
      const handle = await ctx.launch()
      const main = await ctx.app.evaluate(({ app }) => ({
        name: app.getName(),
        userData: app.getPath('userData'),
        argv: process.argv.slice(1)
      }))
      const info = await ctx.page.evaluate(() => window.mqtey.app.getInfo())
      log(`name=${main.name} version=${info.version} argv=${JSON.stringify(main.argv)}`)
      expect(
        main.argv.some((arg) => samePath(arg, MAIN)),
        'not a file-mode launch of the main script',
        main.argv
      )
      expect(main.name === 'mqtey', 'app.getName() is not mqtey', main.name)
      expect(info.name === 'mqtey', 'AppInfo.name is not mqtey', info.name)
      expect(info.version === VERSION, `AppInfo.version is not ${VERSION}`, info.version)
      expect(samePath(main.userData, handle.userData), 'userData is not the override', main.userData)
      expect(samePath(info.userDataPath, handle.userData), 'AppInfo.userDataPath', info.userDataPath)
    })

    await step('a second launch on the same profile quits at once', async () => {
      const second = await spawnApp({ userData: ctx.handle.userData, timeout: QUIT_TIMEOUT })
      log(`exit code ${second.code} after ${second.ms} ms`)
      expect(!second.timedOut, `the second launch was still running after ${QUIT_TIMEOUT} ms`)
      expect(second.code === 0, 'the second launch did not exit with code 0', {
        code: second.code,
        signal: second.signal,
        stderr: second.stderr.slice(0, 300)
      })
      const first = await ctx.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((win) => ({ title: win.getTitle(), visible: win.isVisible() }))
      )
      expect(first.length === 1, 'the first instance does not have exactly one window', first)
      expect(first[0].title === AUTOMATION_TITLE, 'the first window changed its title', first)
      await ctx.waitForTestId('welcome')
    })

    await step('MQTEY_E2E=1 without MQTEY_USER_DATA_DIR refuses to start', async () => {
      // Electron ignores APPDATA on Windows; the containment (spawnApp) is what protects the
      // real profile. A temporary APPDATA still catches code that would read the variable.
      const appData = createProfile('appdata')
      const env = Object.hasOwn(process.env, 'APPDATA') ? { APPDATA: appData } : {}
      let guarded = null
      try {
        guarded = await spawnApp({
          simulateMissingProfile: true,
          keepProfile: true,
          env,
          timeout: QUIT_TIMEOUT
        })
        log(`exit code ${guarded.code} after ${guarded.ms} ms: ${guarded.stderr.trim().split('\n')[0]}`)
        expect(!guarded.timedOut, 'the guarded launch kept running')
        expect(guarded.code === 2, 'the guarded launch did not exit with code 2', {
          code: guarded.code,
          stderr: guarded.stderr.slice(0, 400)
        })
        expect(
          guarded.stderr.includes('MQTEY_E2E=1 needs MQTEY_USER_DATA_DIR'),
          'the guard did not say why',
          guarded.stderr.slice(0, 400)
        )
        const written = readdirSync(guarded.userData)
        expect(written.length === 0, 'the guarded launch wrote into its profile', written)
        const inAppData = readdirSync(appData)
        expect(inAppData.length === 0, 'the guarded launch wrote into APPDATA', inAppData)
      } finally {
        if (guarded) removeProfile(guarded.userData)
        removeProfile(appData)
      }
    })
  }
}
