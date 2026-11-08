# End-to-end run

`run.mjs` drives the **built** app (`out/`) with Playwright's Electron support against an
in-process [aedes](https://github.com/moscajs/aedes) broker (MQTT 3.1.1) on a free local port.
It is a plain Node script, without a test framework.

```bash
npm run test:e2e        # electron-vite build && node tests/e2e/run.mjs
node tests/e2e/run.mjs  # run again without rebuilding
```

What it does:

- Starts the broker, then launches the built main script (`out/main/index.js`; set
  `MQTEY_E2E_OUT=out-<name>` to run a build made with `npx electron-vite build --outDir out-<name>`).
  The environment is copied from the shell without `ELECTRON_RUN_AS_NODE` and
  `ELECTRON_RENDERER_URL`, `MQTEY_USER_DATA_DIR` points to a fresh temporary profile, and
  `MQTEY_E2E=1` makes the window an off-screen, unfocused tool window with no taskbar or Alt+Tab
  entry: nothing appears on the desktop while the run is in progress.
- Drives the UI only through `data-testid` hooks:
  1. welcome → new connection (MQTT 3.1.1) → save & connect
  2. subscribe to `#` → publish `e2e/hello` → message rows (out + in) → message detail
  3. five numeric payloads from a raw mqtt.js client → topic tree → chart
  4. logs → settings (dark, then light theme) → command palette
- Also checks that popovers and menus open inside the window, and that the title bar leaves room
  for the native window controls (Windows / Linux).
- Fails on the first failing step, console error or page error. It prints the step, saves
  `FAILED-<step>.png` and exits with code 1. Console warnings are listed but do not fail the run.

Screenshots of every major step, in the light and the dark theme, are written to
`$MQTEY_E2E_ARTIFACTS`, or to `<os tmpdir>/mqtey-e2e` by default. The folder is printed at the
end. On Windows, `MQTEY_E2E_ARTIFACTS=D:\shots npm run test:e2e` only works from a POSIX shell;
in PowerShell, set `$env:MQTEY_E2E_ARTIFACTS` first.

When running from VS Code (whose terminal exports `ELECTRON_RUN_AS_NODE=1`), nothing special is
needed: the script removes that variable before launching Electron.
