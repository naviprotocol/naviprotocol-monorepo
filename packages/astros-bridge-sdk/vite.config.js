import { defineConfig } from 'vite'

import baseConfig from '../../config/vite.lib.config'

const baseExternal = baseConfig.build?.rollupOptions?.external

const shouldBundle = (id) =>
  id === '@mayanfinance/swap-sdk' || id.startsWith('@mayanfinance/swap-sdk/')

export const bridgeExternal = (id, ...args) => {
  if (shouldBundle(id)) {
    return false
  }
  if (typeof baseExternal === 'function') {
    return baseExternal(id, ...args)
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
      external: bridgeExternal
    }
  }
})
