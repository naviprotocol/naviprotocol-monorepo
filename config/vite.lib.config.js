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

function addJsExtensionsToDts(distDir) {
  const rewriteSpecifier = (specifier, fromFile) => {
    // Already has .js extension
    if (specifier.endsWith('.js')) return specifier
    // Has other extension (e.g., .json, .css)
    if (/\.\w+$/.test(specifier)) return specifier

    // Resolve the specifier relative to the file's directory
    const fromDir = path.dirname(fromFile)
    const resolved = path.resolve(fromDir, specifier)

    // Check if it's a directory (barrel import)
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      return specifier + '/index.js'
    }
    // Otherwise it's a file
    return specifier + '.js'
  }

  const processFile = (filePath) => {
    let content = fs.readFileSync(filePath, 'utf8')
    let modified = false

    // Match: from './path' or from "../path"
    content = content.replace(
      /(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g,
      (match, prefix, specifier, suffix) => {
        const newSpecifier = rewriteSpecifier(specifier, filePath)
        if (newSpecifier !== specifier) modified = true
        return prefix + newSpecifier + suffix
      }
    )

    // Match: export * from './path'
    content = content.replace(
      /(export\s+\*\s+from\s+['"])(\.\.?\/[^'"]+?)(['"])/g,
      (match, prefix, specifier, suffix) => {
        const newSpecifier = rewriteSpecifier(specifier, filePath)
        if (newSpecifier !== specifier) modified = true
        return prefix + newSpecifier + suffix
      }
    )

    if (modified) {
      fs.writeFileSync(filePath, content)
    }
  }

  const walk = (dir) => {
    for (const file of fs.readdirSync(dir)) {
      const filePath = path.join(dir, file)
      const stat = fs.statSync(filePath)
      if (stat.isDirectory()) {
        walk(filePath)
      } else if (file.endsWith('.d.ts') && !file.endsWith('.d.ts.map')) {
        processFile(filePath)
      }
    }
  }

  walk(distDir)
}

function generateMissingBarrelJs(distDir) {
  const walk = (dir) => {
    for (const file of fs.readdirSync(dir)) {
      const filePath = path.join(dir, file)
      const stat = fs.statSync(filePath)
      if (stat.isDirectory()) {
        walk(filePath)
      } else if (file === 'index.d.ts') {
        const jsFile = path.join(dir, 'index.js')
        if (!fs.existsSync(jsFile)) {
          // Parse the .d.ts to extract re-exports and generate matching JS
          const dtsContent = fs.readFileSync(filePath, 'utf8')
          const exports = []
          const reExportRegex = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g
          let match
          while ((match = reExportRegex.exec(dtsContent)) !== null) {
            exports.push(`export * from '${match[1]}';`)
          }
          if (exports.length > 0) {
            fs.writeFileSync(jsFile, exports.join('\n') + '\n')
          }
        }
      }
    }
  }
  walk(distDir)
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
        const distDir = path.join(PWD, 'dist')
        addJsExtensionsToDts(distDir)
        generateMissingBarrelJs(distDir)
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
