/**
 * check-package: build the app into an out-<name> folder of its own and package it build-only
 * (`electron-builder --win --dir`, never an installer) into a dist-<name> folder of its own.
 *
 * The package uses electron-builder.yml with two changes only: the output folder, and the build
 * taken from out-<name> instead of out/. That build is packed as out/, so app.asar and its
 * package.json (`main: ./out/main/index.js`) look exactly like a release's.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const require = createRequire(join(ROOT, 'package.json'))
/** Loads the modules electron-builder itself uses (js-yaml, @electron/asar, @electron/fuses). */
export const builderRequire = createRequire(require.resolve('app-builder-lib/package.json'))

const cliOf = (pkg, script) => join(dirname(require.resolve(`${pkg}/package.json`)), script)

/** Runs a Node CLI in the repo; resolves with its output, rejects with the end of it. */
function runNode(script, args, { label, env = process.env }) {
  return new Promise((done, fail) => {
    const started = Date.now()
    const child = spawn(process.execPath, [script, ...args], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let output = ''
    child.stdout.on('data', (data) => (output += data))
    child.stderr.on('data', (data) => (output += data))
    child.on('error', fail)
    child.on('exit', (code) => {
      const seconds = (Date.now() - started) / 1000
      if (code === 0) done({ output, seconds })
      else
        fail(new Error(`${label}: exit code ${code}\n${output.split('\n').slice(-40).join('\n')}`))
    })
  })
}

/** `electron-vite build --outDir <outName>` (the production build, as `npm run build` makes it). */
export function buildApp(outName) {
  const cli = cliOf('electron-vite', 'bin/electron-vite.js')
  return runNode(cli, ['build', '--outDir', outName], { label: 'electron-vite build' })
}

/**
 * electron-builder.yml for packaging `outName` into `distName`. The exclusions that can match
 * inside a build (those under out/, made relative to it, and those for any folder) apply to
 * `outName` as they would to out/.
 */
export function packageConfig(outName, distName) {
  if (!/^out-[\w.-]+$/.test(outName) || !/^dist-[\w.-]+$/.test(distName)) {
    throw new Error(`refusing to package ${outName} into ${distName}: use out-<name> / dist-<name>`)
  }
  const yaml = builderRequire('js-yaml')
  const config = yaml.load(readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8'))
  const files = Array.isArray(config.files) ? config.files : []
  if (files.filter((pattern) => pattern === 'out/**').length !== 1) {
    throw new Error("electron-builder.yml no longer lists 'out/**' in files: update package-build")
  }
  const inBuild = files
    .filter((pattern) => typeof pattern === 'string' && pattern.startsWith('!'))
    .flatMap((pattern) => {
      if (pattern.startsWith('!out/')) return [`!${pattern.slice('!out/'.length)}`]
      return pattern.startsWith('!**/') ? [pattern] : []
    })
  return {
    ...config,
    directories: { ...config.directories, output: distName },
    files: files.map((pattern) =>
      pattern === 'out/**' ? { from: outName, to: 'out', filter: ['**/*', ...inBuild] } : pattern
    )
  }
}

/** `electron-builder --win --dir` of `outName` into `distName` (no installer, no publishing). */
export async function packageApp(outName, distName) {
  const folder = mkdtempSync(join(tmpdir(), 'mqtt-in-package-config-'))
  try {
    const configFile = join(folder, 'electron-builder.json')
    writeFileSync(configFile, JSON.stringify(packageConfig(outName, distName), null, 2))
    const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
    delete env.ELECTRON_RUN_AS_NODE
    const args = ['--win', '--dir', '--publish', 'never', '--projectDir', ROOT]
    return await runNode(cliOf('electron-builder', 'cli.js'), [...args, '--config', configFile], {
      label: 'electron-builder --win --dir',
      env
    })
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}
