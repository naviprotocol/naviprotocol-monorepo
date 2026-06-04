import { defineConfig } from 'vite'

import baseConfig from '../../config/vite.lib.config'

const baseExternal = baseConfig.build?.rollupOptions?.external

const mayanImporterPattern =
  /(?:^|[/\\])(?:@mayanfinance[/\\]swap-sdk|\.pnpm[/\\]@mayanfinance\+swap-sdk@)/

const shouldBundle = (id) =>
  id === '@mayanfinance/swap-sdk' ||
  id.startsWith('@mayanfinance/swap-sdk/') ||
  id === '@mysten/sui-v1' ||
  id.startsWith('@mysten/sui-v1/')

const isMayanImporter = (importer) => Boolean(importer && mayanImporterPattern.test(importer))

export const resolveMayanLegacySuiImport = (id, importer) => {
  if ((id === '@mysten/sui' || id.startsWith('@mysten/sui/')) && isMayanImporter(importer)) {
    return id.replace('@mysten/sui', '@mysten/sui-v1')
  }
  return null
}

export const bridgeExternal = (id, importer, ...args) => {
  if (shouldBundle(id) || resolveMayanLegacySuiImport(id, importer)) {
    return false
  }
  if (typeof baseExternal === 'function') {
    return baseExternal(id, importer, ...args)
  }
  if (Array.isArray(baseExternal)) {
    return baseExternal.includes(id)
  }
  return Boolean(baseExternal)
}

export default defineConfig({
  ...baseConfig,
  build: {
    ...baseConfig.build,
    rollupOptions: {
      ...baseConfig.build?.rollupOptions,
      external: bridgeExternal,
      plugins: [
        {
          name: 'bridge-mayan-legacy-sui',
          async resolveId(id, importer, options) {
            const legacyId = resolveMayanLegacySuiImport(id, importer)
            if (!legacyId) {
              return null
            }
            return this.resolve(legacyId, importer, {
              ...options,
              skipSelf: true
            })
          }
        },
        ...(baseConfig.build?.rollupOptions?.plugins || [])
      ]
    }
  }
})
