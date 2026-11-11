/**
 * Browser client bundle. The host serves this file as a script, not as a Node
 * module. The factory stays lazy until the page module loader materializes it,
 * and platform modules such as react resolve through the injected require.
 */
import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { name: string }
const id = manifest.name

const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']

export default defineConfig({
  name: `${id}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  hash: false,
  // Keep platform modules external; inline every other specifier. tsdown 0.16
  // expresses that with external/noExternal rather than deps.neverBundle.
  external: CLIENT_EXTERNALS,
  noExternal: (specifier: string) => !CLIENT_EXTERNALS.includes(specifier),
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
})
