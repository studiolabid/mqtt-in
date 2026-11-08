/**
 * Bundle check of a finished build: out/ by default, or MQTTIN_E2E_OUT=out-<name> for a build made
 * with `npx electron-vite build --outDir out-<name>`.
 *
 *   npm run test:bundle     (node tests/e2e/check-bundle.mjs; npm run test:e2e runs it as well)
 *
 * It fails when
 * - the startup JavaScript (the renderer entry chunk and every chunk it imports statically, i.e.
 *   what loads before the welcome screen) exceeds 1.2 MB;
 * - that static graph reaches CodeMirror (@codemirror, @lezer), uPlot or the payload diff (diff,
 *   utils/diff.ts), or the CodeEditor, TimeSeriesChart or PayloadDiff components: all of them
 *   load lazily;
 * - the renderer JavaScript or CSS is not minified, main or preload is minified, or a source map
 *   is part of the build.
 *
 * It reads two files of the renderer build (electron.vite.config.ts enables both, and
 * electron-builder.yml never packages them): .vite/manifest.json, every chunk with its static
 * imports, and .vite/ssr-manifest.json, every bundled module with the files it was emitted into
 * (modules of the entry chunk list no .js file). Exit code 0 = passed, 1 = failed.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT_DIR = process.env.MQTTIN_E2E_OUT || 'out'
const OUT = resolve(ROOT, OUT_DIR)
const RENDERER = join(OUT, 'renderer')
const VITE_DIR = join(RENDERER, '.vite')

/** Bytes of JavaScript the renderer may load before its first screen. */
const STARTUP_BUDGET = 1_200_000
/** Average characters per line: minified code is above, readable code below. */
const MINIFIED_LINE = 200
const READABLE_LINE = 120

/** Components that load on first use, with the libraries only they may bring in. */
const LAZY = [
  {
    component: 'src/components/common/CodeEditor.vue',
    library: 'CodeMirror',
    modules: /(^|\/)node_modules\/(@codemirror|@lezer|codemirror)\//
  },
  {
    component: 'src/components/common/TimeSeriesChart.vue',
    library: 'uPlot',
    modules: /(^|\/)node_modules\/uplot\//
  },
  {
    component: 'src/components/common/PayloadDiff.vue',
    library: 'diff',
    modules: /(^|\/)node_modules\/diff\/|^src\/utils\/diff\.ts$/
  }
]

const results = []
function check(name, ok, detail = '') {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const kb = (bytes) => `${(bytes / 1000).toFixed(1)} kB`
const bytesOf = (file) => statSync(join(RENDERER, file)).size
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
/** Characters per line over a set of files. */
function lineLength(paths) {
  let chars = 0
  let lines = 0
  for (const path of paths) {
    const text = readFileSync(path, 'utf8')
    chars += text.length
    lines += text.split('\n').length
  }
  return Math.round(chars / Math.max(1, lines))
}

if (
  !existsSync(join(VITE_DIR, 'manifest.json')) ||
  !existsSync(join(VITE_DIR, 'ssr-manifest.json'))
) {
  const build = `npx electron-vite build${OUT_DIR === 'out' ? '' : ` --outDir ${OUT_DIR}`}`
  console.error(`✗ No build manifests in ${VITE_DIR}. Build first: ${build}`)
  console.error('  (electron.vite.config.ts enables build.manifest and build.ssrManifest)')
  process.exit(1)
}
const manifest = readJson(join(VITE_DIR, 'manifest.json'))
const modules = readJson(join(VITE_DIR, 'ssr-manifest.json'))

// The startup graph: the entry chunks and, transitively, every chunk they import statically.
const entries = Object.keys(manifest).filter((key) => manifest[key].isEntry)
const startup = new Set()
const visit = (key) => {
  if (startup.has(key) || !manifest[key]) return
  startup.add(key)
  for (const dep of manifest[key].imports ?? []) visit(dep)
}
entries.forEach(visit)
const entryFiles = entries.map((key) => manifest[key].file)
const startupFiles = [...startup].map((key) => manifest[key].file).filter((f) => f.endsWith('.js'))
const startupBytes = startupFiles.reduce((sum, file) => sum + bytesOf(file), 0)
const startupCss = [...new Set([...startup].flatMap((key) => manifest[key].css ?? []))]

console.log(`mqtt-in bundle check — ${relative(ROOT, RENDERER) || RENDERER}`)
console.log('Startup JavaScript (entry chunk + its static imports):')
for (const file of [...startupFiles].sort((a, b) => bytesOf(b) - bytesOf(a))) {
  console.log(
    `  ${kb(bytesOf(file)).padStart(9)}  ${file}${entryFiles.includes(file) ? ' (entry)' : ''}`
  )
}
console.log(`  ${kb(startupBytes).padStart(9)}  total, budget ${kb(STARTUP_BUDGET)}`)
const cssBytes = startupCss.reduce((sum, file) => sum + bytesOf(file), 0)
console.log(`Startup CSS: ${kb(cssBytes)} in ${startupCss.length} files\n`)

check('renderer entry chunk found', entryFiles.length > 0, entryFiles.join(', '))
const entryBytes = entryFiles.reduce((sum, file) => sum + bytesOf(file), 0)
check(
  `startup JavaScript under ${kb(STARTUP_BUDGET)}`,
  entryFiles.length > 0 && startupBytes <= STARTUP_BUDGET,
  `${kb(startupBytes)} in ${startupFiles.length} chunks (entry chunk ${kb(entryBytes)})`
)

/** The JS files a module went into; modules of the entry chunk list only its assets. */
function chunksOf(id) {
  const js = modules[id].filter((file) => file.endsWith('.js')).map((f) => f.replace(/^\.?\//, ''))
  return js.length > 0 ? js : entryFiles
}
for (const { component, library, modules: pattern } of LAZY) {
  const name = component.split('/').pop().replace('.vue', '')
  const own = Object.keys(modules).filter(
    (id) => id === component || id.startsWith(`${component}?`)
  )
  const lib = Object.keys(modules).filter((id) => pattern.test(id))
  const atStartup = [...own, ...lib].filter((id) =>
    chunksOf(id).some((f) => startupFiles.includes(f))
  )
  const lazyFiles = [...new Set([...own, ...lib].flatMap(chunksOf))]
  const where = lazyFiles.map((file) => `${file} (${kb(bytesOf(file))})`).join(', ')
  let detail = `${lib.length} ${library} modules in ${where}`
  if (own.length === 0 || lib.length === 0) {
    const counts = `${own.length} component, ${lib.length} library modules`
    detail = `not found in the build (${counts}): update LAZY in this file`
  } else if (atStartup.length > 0) {
    detail = `statically reachable from the entry: ${atStartup.slice(0, 4).join(', ')}`
  }
  check(
    `${name} and ${library} load lazily`,
    own.length > 0 && lib.length > 0 && !atStartup.length,
    detail
  )
}

const rendererJs = Object.values(manifest)
  .map((chunk) => chunk.file)
  .filter((file) => file.endsWith('.js'))
const jsLine = lineLength(rendererJs.map((file) => join(RENDERER, file)))
check('renderer JavaScript minified', jsLine >= MINIFIED_LINE, `${jsLine} characters per line`)
const cssLine = lineLength(startupCss.map((file) => join(RENDERER, file)))
check(
  'renderer CSS minified',
  startupCss.length > 0 && cssLine >= MINIFIED_LINE,
  `${cssLine} per line`
)
for (const part of ['main', 'preload']) {
  const script = ['index.js', 'index.mjs', 'index.cjs']
    .map((n) => join(OUT, part, n))
    .find(existsSync)
  const line = script ? lineLength([script]) : 0
  check(
    `${part} readable (not minified)`,
    Boolean(script) && line < READABLE_LINE,
    `${line} per line`
  )
}
const maps = readdirSync(OUT, { recursive: true }).filter((file) => String(file).endsWith('.map'))
check('no source maps in the build', maps.length === 0, maps.slice(0, 3).join(', '))

const failed = results.filter((ok) => !ok).length
const passed = `${results.length - failed}/${results.length}`
console.log(`\n${failed === 0 ? '✓' : '✗'} ${passed} bundle checks passed`)
process.exitCode = failed === 0 ? 0 : 1
