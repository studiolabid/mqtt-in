<div align="center">

<img src="resources/logo.svg" width="96" height="96" alt="mqtt-in logo" />

# mqtt-in

**A fast, clean and powerful MQTT client for the desktop.** It speaks WebSocket and Socket.IO too.

Windows · macOS · Linux &nbsp;|&nbsp; MQTT 3.1 · 3.1.1 · 5.0 · WebSocket · Socket.IO &nbsp;|&nbsp; `mqtt` · `mqtts` · `ws` · `wss`

<br />

<img src="docs/screenshots/workspace-dark.png" alt="mqtt-in workspace: connections, subscriptions, live messages and the message detail" width="900" />

</div>

---

## Highlights

|                           |                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Connections**           | Many brokers side by side, groups, import / export (also from MQTTX), paste a full URL like `wss://user:pass@host:443/mqtt` to fill the form at once                                                                                                                                                                                                                                       |
| **Every option**          | MQTT 3.1 / 3.1.1 / 5.0, TLS (CA, client certificate and key, SNI, ALPN), WebSocket path, Last Will, keep-alive, auto-reconnect, connect on startup, MQTT 5 connect properties                                                                                                                                                                                                              |
| **WebSocket & Socket.IO** | Monitor plain WebSocket servers (headers, subprotocols, topics from a JSON field) and Socket.IO servers 3 / 4 (namespace, auth, every event by name) in the same message list, topic tree, charts and publisher                                                                                                                                                                            |
| **Subscriptions**         | QoS, color tags, aliases, enable / disable, MQTT 5 options (no local, retain as published, retain handling), granted QoS and refusals shown                                                                                                                                                                                                                                                |
| **Live messages**         | Virtualized stream that stays smooth under load, filters (direction, topic wildcard, text, retained), pause, payload views: JSON, text, hex, base64, MessagePack, CBOR                                                                                                                                                                                                                     |
| **Publishing**            | Payload editor with JSON formatting, templates (`{{uuid}}`, `{{random(1,9)}}`…), history, saved messages (type a saved name in the payload and press Tab, or publish it from the list), MQTT 5 properties, repeat publishing (interval and count). Retain never turns itself on: it is not restored after a restart nor copied from a received message, and a retained publish offers Undo |
| **Topic explorer**        | Live topic tree with counts and last values (changed lines flash on update), history with diff, numeric charts, clear retained messages                                                                                                                                                                                                                                                    |
| **Productivity**          | Command palette (<kbd>Ctrl</kbd> <kbd>K</kbd>), keyboard shortcuts, copy as `mosquitto_pub` / MQTTX command, light and dark theme                                                                                                                                                                                                                                                          |
| **Privacy**               | Passwords are encrypted with the operating system keychain; everything stays on your machine                                                                                                                                                                                                                                                                                               |

## Screenshots

|                                   Topic tree and live chart                                   |                              Connection settings                              |
| :-------------------------------------------------------------------------------------------: | :---------------------------------------------------------------------------: |
|   <img src="docs/screenshots/topics-chart-light.png" alt="Topic tree and numeric chart" />    |  <img src="docs/screenshots/connection-light.png" alt="Connection dialog" />  |
|                                  **Welcome and quick start**                                  |                              **Command palette**                              |
| <img src="docs/screenshots/welcome-dark.png" alt="Welcome screen with quick start brokers" /> | <img src="docs/screenshots/command-palette-dark.png" alt="Command palette" /> |

## Getting started

There are no published installers yet: build mqtt-in from source.

```bash
git clone https://github.com/studiolabid/mqtt-in.git
cd mqtt-in
npm ci
npm run build:win     # or build:mac / build:linux, the installer lands in dist/
```

### Connect to a broker

1. Click **New connection** (<kbd>Ctrl</kbd> <kbd>N</kbd>), or pick a public test broker under **Quick start**.
2. Paste the broker URL into the host field, e.g. `wss://broker.emqx.io:8084/mqtt`. Protocol, host, port and
   WebSocket path are filled in for you.
3. Add the username and password under **Authentication** if the broker needs them.
4. **Save & connect**, then add a subscription (<kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>N</kbd>) such as `#`.
5. Type a topic and payload in the publish panel and press <kbd>Ctrl</kbd> <kbd>Enter</kbd>.

### Keyboard shortcuts

| Action           | Shortcut                                      |
| ---------------- | --------------------------------------------- |
| Command palette  | <kbd>Ctrl</kbd> <kbd>K</kbd>                  |
| New connection   | <kbd>Ctrl</kbd> <kbd>N</kbd>                  |
| New subscription | <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>N</kbd> |
| Publish          | <kbd>Ctrl</kbd> <kbd>Enter</kbd>              |
| Search messages  | <kbd>Ctrl</kbd> <kbd>F</kbd>                  |

On macOS use <kbd>⌘</kbd> instead of <kbd>Ctrl</kbd>. The full list is under **All shortcuts** on the welcome screen.

### Where your data lives

Connections, settings and history are stored as JSON files in the app's profile folder:

| OS      | Folder                                  |
| ------- | --------------------------------------- |
| Windows | `%APPDATA%\mqtt-in`                     |
| macOS   | `~/Library/Application Support/mqtt-in` |
| Linux   | `~/.config/mqtt-in`                     |

Passwords and key passphrases are encrypted with Electron `safeStorage` (Windows DPAPI, macOS Keychain,
libsecret on Linux).

## Development

Requirements: **Node.js 20.19+** and npm.

```bash
npm ci          # install dependencies
npm run dev     # start the app with hot reload
```

| Script                                            | What it does                                            |
| ------------------------------------------------- | ------------------------------------------------------- |
| `npm run dev`                                     | Development app with hot reload                         |
| `npm run typecheck`                               | Type-check main, preload, renderer and tests            |
| `npm run lint`                                    | ESLint + Prettier rules                                 |
| `npm run format`                                  | Format the code with Prettier                           |
| `npm test`                                        | Unit tests (Vitest)                                     |
| `npm run test:e2e`                                | Build, check the bundle, then run the end-to-end suites |
| `npm run test:package`                            | Build the installer and smoke-test the packaged app     |
| `npm run build`                                   | Type-check and build into `out/`                        |
| `npm run build:win` / `build:mac` / `build:linux` | Build an installer into `dist/`                         |

### Testing

- **Unit tests**: Vitest, including real mqtt.js sessions against local brokers.
- **End-to-end**: Playwright drives the built app against an in-process [aedes](https://github.com/moscajs/aedes)
  broker. Test runs set `MQTTIN_E2E=1` and a fresh `MQTTIN_USER_DATA_DIR`, so the window stays off-screen and
  your own profile is never touched. See [tests/e2e/README.md](tests/e2e/README.md).

### Project structuredsadas

```text
src/
├── main/       Electron main process: MQTT sessions (mqtt.js), storage, IPC, window, security
├── preload/    The typed bridge exposed to the UI as window.mqttIn
├── renderer/   Vue 3 UI: features, stores (Pinia), shadcn-vue components
└── shared/     Pure TypeScript shared by all sides: models, IPC contract, codecs, topic utils
tests/
├── unit/       Vitest
└── e2e/        Playwright end-to-end suites
```

### Tech stack

[Electron](https://www.electronjs.org/) · [electron-vite](https://electron-vite.org/) · [Vue 3](https://vuejs.org/) ·
TypeScript · [shadcn-vue](https://www.shadcn-vue.com/) (reka-ui, Tailwind CSS 4) · [Pinia](https://pinia.vuejs.org/) ·
[mqtt.js](https://github.com/mqttjs/MQTT.js) · [CodeMirror 6](https://codemirror.net/) · [uPlot](https://github.com/leeoniya/uPlot)

---

<div align="center">

Powered by **[studiolab.id](https://studiolab.id)**

</div>
