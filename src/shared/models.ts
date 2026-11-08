/**
 * Domain models shared by the main process, the preload bridge and the renderer.
 * Import them from here (`@shared/models`); the types live in `./models/*` by area:
 * connection (profiles, primitives, import / export), message (messages, publishing, repeat
 * jobs, payload formats), runtime (session status and events), settings and app (app facts,
 * file dialogs, storage notices).
 *
 * Rules:
 *  - Pure types only (no runtime imports from electron / node / vue).
 *  - Everything here must be structured-clone friendly (it travels over IPC).
 *  - Durations follow mqtt.js conventions: `keepalive` in seconds, timeouts/periods in ms.
 */
export type * from './models/connection'
export type * from './models/message'
export type * from './models/runtime'
export type * from './models/settings'
export type * from './models/app'
