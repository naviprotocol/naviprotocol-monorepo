import replace from '@rollup/plugin-replace'
import fs from 'fs'
import path from 'path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import tsconfigPaths from 'vite-tsconfig-paths'

const PWD = process.env.PWD
const pkg = require(path.join(PWD, 'package.json'))

const tsEntry = path.resolve(PWD, 'src/index.ts')
const entry = fs.existsSync(tsEntry) ? tsEntry : tsEntry.replace('.ts', '.tsx')

const deps = [...Object.keys(Object.assign({}, pkg.peerDependencies, pkg.dependencies))]

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    dts({
      exclude: ['**/*.spec.ts', '**/*.test.ts', '**/tests/**'],
      entryRoot: 'src',
      // Was defaulting to true until version 1.7
      skipDiagnostics: true,
      // Was defaulting to true until version 2.0
      copyDtsFiles: true
    })
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    reporters: 'verbose',
    include: [`${PWD}/src/**/*.{spec,test}.{ts,tsx}`, `${PWD}/tests/**/*.{spec,test}.{ts,tsx}`],
    coverage: {
      enabled: process.env.CI === 'true',
      reporter: ['json']
    }
  },
  build: {
    target: 'es2019',
    sourcemap: true,
    lib: {
      entry,
      name: pkg.name,
      fileName: (format) => (format === 'cjs' ? `index.cjs.js` : `index.esm.js`),
      formats: ['cjs', 'es']
    },
    rollupOptions: {
      external: (id) => deps.some((dep) => id.startsWith(dep)),
      plugins: [
        replace({
          preventAssignment: true,
          'exports.hasOwnProperty(': 'Object.prototype.hasOwnProperty.call(exports,'
        })
      ],
      output: {
        globals: {}
      }
    }
  }
})
