import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

/**
 * Windows: a shell may report the working directory with a lowercase drive letter (`d:\mqttin`,
 * e.g. Git Bash). Paths derived from it then differ in case from the ones Node resolves for
 * node_modules, and the bundler treats them as different modules: Pinia was bundled twice, the
 * stores found no active Pinia and the packaged window stayed blank. Always build from `D:\…`.
 * tests/e2e/check-bundle.mjs checks that the framework packages are bundled once.
 */
const cwd = process.cwd()
if (process.platform === 'win32' && /^[a-z]:/.test(cwd)) {
  process.chdir(cwd[0].toUpperCase() + cwd.slice(1))
}

const shared = resolve('src/shared')

/**
 * Main and preload stay unminified, so stack traces in logs/main.log point at readable code.
 * No production source maps anywhere: they would carry the full source (`electron-vite build
 * --sourcemap` still makes them for local debugging).
 */
const nodeBuild = { minify: false, sourcemap: false }

export default defineConfig({
  main: {
    resolve: {
      alias: { '@shared': shared }
    },
    build: nodeBuild
  },
  preload: {
    resolve: {
      alias: { '@shared': shared }
    },
    build: nodeBuild
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src'),
        '@shared': shared
      }
    },
    plugins: [vue(), tailwindcss()],
    build: {
      // electron-vite leaves the renderer unminified by default.
      minify: true,
      cssMinify: true,
      sourcemap: false,
      // Third-party license notices (`/*! … */`, `@license`) stay in the minified chunks.
      rolldownOptions: { output: { comments: { legal: true } } },
      // out/renderer/.vite/manifest.json (chunk graph) and ssr-manifest.json (module → chunk),
      // read by tests/e2e/check-bundle.mjs. electron-builder.yml leaves them out of the package.
      manifest: true,
      ssrManifest: true
    }
  }
})
