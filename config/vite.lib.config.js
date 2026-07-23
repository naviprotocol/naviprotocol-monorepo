import replace from '@rollup/plugin-replace'
import fs from 'fs'
import path from 'path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import tsconfigPaths from 'vite-tsconfig-paths'

const PWD = process.cwd()
const pkg = JSON.parse(fs.readFileSync(path.join(PWD, 'package.json'), 'utf8'))

const tsEntry = path.resolve(PWD, 'src/index.ts')
const entry = fs.existsSync(tsEntry) ? tsEntry : tsEntry.replace('.ts', '.tsx')

const deps = [...Object.keys(Object.assign({}, pkg.peerDependencies, pkg.dependencies))]

function addJsExtensionsToDts(dir) {
  const files = fs.readdirSync(dir)
  for (const file of files) {
    const filePath = path.join(dir, file)
    const stat = fs.statSync(filePath)
    if (stat.isDirectory()) {
      addJsExtensionsToDts(filePath)
    } else if (file.endsWith('.d.ts') && !file.endsWith('.d.ts.map')) {
      let content = fs.readFileSync(filePath, 'utf8')
      // Add .js extension to relative imports/exports that don't have an extension
      content = content.replace(/(from\s+['"])(\.\.?\/[^'"]+?)(?<!\.js)(['"])/g, '$1$2.js$3')
      content = content.replace(
        /(export\s+\*\s+from\s+['"])(\.\.?\/[^'"]+?)(?<!\.js)(['"])/g,
        '$1$2.js$3'
      )
      fs.writeFileSync(filePath, content)
    }
  }
}

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    dts({
      exclude: ['**/*.spec.ts', '**/*.test.ts', '**/tests/**'],
      entryRoot: 'src',
      // Was defaulting to true until version 1.7
      skipDiagnostics: true,
      // Was defaulting to true until version 2.0
      copyDtsFiles: true,
      afterBuild: () => {
        addJsExtensionsToDts(path.join(PWD, 'dist'))
      }
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
    target: 'es2020',
    sourcemap: true,
    lib: {
      entry,
      name: pkg.name,
      formats: ['es']
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
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js'
      }
    }
  }
})
