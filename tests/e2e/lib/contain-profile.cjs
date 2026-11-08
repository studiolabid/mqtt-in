/**
 * Preloaded into the main process (`electron -r contain-profile.cjs <main>`) by
 * spawnApp({ simulateMissingProfile: true }), to check the profile guard (MQTTIN_E2E=1 without
 * MQTTIN_USER_DATA_DIR must quit with exit code 2) without any risk to the user's profile:
 *
 * - the launch itself still gets MQTTIN_E2E=1 and a fresh MQTTIN_USER_DATA_DIR (kit rule);
 * - this file hides that variable from the app, and pins userData to the fresh folder whatever
 *   the app computes (Electron ignores APPDATA on Windows, so nothing else could contain it);
 * - a single-instance lock request, which only happens when the guard did NOT stop the app,
 *   exits at once with code 97, so a broken guard can never reach the user's own mqtt-in.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app } = require('electron')

const profile = process.env.MQTTIN_USER_DATA_DIR
if (process.env.MQTTIN_E2E !== '1' || !profile || !profile.trim()) {
  console.error('[e2e] contain-profile: refusing to run without MQTTIN_E2E=1 and a profile')
  app.exit(98)
} else {
  delete process.env.MQTTIN_USER_DATA_DIR
  const setPath = app.setPath.bind(app)
  setPath('userData', profile)
  app.setPath = (name, value) => setPath(name, name === 'userData' ? profile : value)
  app.requestSingleInstanceLock = () => {
    console.error('[e2e] contain-profile: the profile guard did not stop the app')
    app.exit(97)
    return false
  }
}
