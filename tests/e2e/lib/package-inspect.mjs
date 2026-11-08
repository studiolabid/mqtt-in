/**
 * check-package: static, read-only checks of a packaged win-unpacked folder: the fuse wire of
 * mqtt-in.exe, what app.asar contains (an allowlist, trimmed node_modules, licenses kept), its
 * size, the locales and the unpacked icon.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, builderRequire } from './package-build.mjs'

/** The fuse wire electron-builder.yml sets (MS-11, MS-12); any other value fails. */
const EXPECTED_FUSES = {
  RunAsNode: false,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  GrantFileProtocolExtraPrivileges: false
}
/** Fuse wire bytes: '1' enabled, '0' disabled. */
const FUSE_ON = '1'.charCodeAt(0)
const FUSE_OFF = '0'.charCodeAt(0)
const ASAR_TOP_LEVEL = ['node_modules', 'out', 'package.json', 'resources']
const ASAR_BUDGET = 8 * 1024 * 1024
const LICENSE_FILE = /^(licen[cs]e|copying)/i

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`
const sample = (rows) =>
  rows.slice(0, 3).join(', ') + (rows.length > 3 ? ` … (${rows.length})` : '')

function folderBytes(path) {
  let total = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const full = join(path, entry.name)
    total += entry.isDirectory() ? folderBytes(full) : statSync(full).size
  }
  return total
}

/** Every file in the archive header, as asar-relative paths with '/'. */
function listAsar(header, prefix = '', rows = []) {
  for (const [name, entry] of Object.entries(header.files ?? {})) {
    const path = prefix ? `${prefix}/${name}` : name
    if (entry.files) listAsar(entry, path, rows)
    else rows.push(path)
  }
  return rows
}

async function checkFuses(exe, check) {
  const { getCurrentFuseWire, FuseV1Options } = builderRequire('@electron/fuses')
  const wire = await getCurrentFuseWire(exe)
  const state = (id) =>
    wire[id] === FUSE_ON ? 'on' : wire[id] === FUSE_OFF ? 'off' : `${wire[id]}`
  const all = Object.entries(FuseV1Options).filter(([, id]) => typeof id === 'number')
  console.log(`  fuse wire: ${all.map(([name, id]) => `${name} ${state(id)}`).join(', ')}`)
  for (const [name, enabled] of Object.entries(EXPECTED_FUSES)) {
    const actual = state(FuseV1Options[name])
    check(`fuse ${name} ${enabled ? 'on' : 'off'}`, actual === (enabled ? 'on' : 'off'), actual)
  }
}

function checkLicenses(paths, check) {
  const packed = new Set(paths)
  const packages = paths
    .filter((path) => /(^|\/)node_modules\/(@[^/]+\/)?[^/]+\/package\.json$/.test(path))
    .map((path) => path.slice(0, -'/package.json'.length))
  const missing = []
  let kept = 0
  for (const pkg of packages) {
    const source = join(ROOT, pkg)
    if (!existsSync(source)) continue
    for (const name of readdirSync(source).filter((file) => LICENSE_FILE.test(file))) {
      if (packed.has(`${pkg}/${name}`)) kept++
      else missing.push(`${pkg}/${name}`)
    }
  }
  check(
    'dependency LICENSE files kept',
    kept > 0 && missing.length === 0,
    missing.length ? `missing ${sample(missing)}` : `${kept} files in ${packages.length} packages`
  )
}

/** Runs every static check on `appDir` (dist-<name>/win-unpacked); `version`: package.json's. */
export async function inspectPackage(appDir, { check, version }) {
  await checkFuses(join(appDir, 'mqtt-in.exe'), check)

  const asar = builderRequire('@electron/asar')
  const archive = join(appDir, 'resources', 'app.asar')
  const paths = listAsar(asar.getRawHeader(archive).header)
  const top = [...new Set(paths.map((path) => path.split('/')[0]))].sort()
  const where = (test) => paths.filter((path) => test(path))
  check(
    'app.asar holds exactly out, node_modules, package.json and resources',
    top.join() === ASAR_TOP_LEVEL.join(),
    top.join(', ')
  )
  check(
    'no source maps',
    where((p) => p.endsWith('.map')).length === 0,
    sample(where((p) => p.endsWith('.map')))
  )
  const otherOut = where((p) => /^out/.test(p) && !p.startsWith('out/'))
  check('no other out* build', otherOut.length === 0, sample(otherOut))
  const manifests = where((p) => p.startsWith('out/renderer/.vite/'))
  check('no build manifests (out/renderer/.vite)', manifests.length === 0, sample(manifests))
  const needed = ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html']
  check(
    'the build is complete',
    needed.every((p) => paths.includes(p)),
    needed.filter((p) => !paths.includes(p)).join(', ')
  )
  const manifest = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'))
  const main = String(manifest.main ?? '').replace(/^\.\//, '')
  check(
    'package.json main and version',
    main === 'out/main/index.js' && manifest.version === version,
    `${manifest.main} v${manifest.version}`
  )

  const mqttDist = where((p) => p.startsWith('node_modules/mqtt/dist/'))
  check('no mqtt browser bundles (node_modules/mqtt/dist)', mqttDist.length === 0, sample(mqttDist))
  check(
    'mqtt runtime present (node_modules/mqtt/build/index.js)',
    paths.includes('node_modules/mqtt/build/index.js')
  )
  const typescript = where((p) => p.startsWith('node_modules/') && /\.(ts|tsbuildinfo)$/.test(p))
  check('no .ts or .tsbuildinfo in node_modules', typescript.length === 0, sample(typescript))
  const tests = where(
    (p) =>
      /(^|\/)node_modules\/(.*\/)?(test|tests|__tests__|benchmarks|examples?)\//.test(p) ||
      p === 'node_modules/mqtt-packet/test.js'
  )
  check('no dependency tests, benchmarks or examples', tests.length === 0, sample(tests))
  const changelogs = where(
    (p) =>
      p.startsWith('node_modules/') && /(^|\/)(CHANGELOG|CONTRIBUTING|HISTORY)[^/]*\.md$/.test(p)
  )
  check('no dependency changelogs', changelogs.length === 0, sample(changelogs))
  checkLicenses(paths, check)

  const asarBytes = statSync(archive).size
  const packages = where((p) =>
    /(^|\/)node_modules\/(@[^/]+\/)?[^/]+\/package\.json$/.test(p)
  ).length
  console.log(`  app.asar: ${paths.length} files, ${packages} node_modules packages`)
  check(`app.asar under ${mb(ASAR_BUDGET)}`, asarBytes < ASAR_BUDGET, mb(asarBytes))
  const locales = readdirSync(join(appDir, 'locales'))
  check('locales: only en-US.pak', locales.join() === 'en-US.pak', locales.join(', '))
  const icon = join(appDir, 'resources', 'app.asar.unpacked', 'resources', 'icon.png')
  check('icon unpacked next to app.asar', existsSync(icon) && statSync(icon).size > 0)
  console.log(`  win-unpacked: ${mb(folderBytes(appDir))}`)
}
