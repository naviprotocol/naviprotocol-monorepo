import { defineConfig } from 'vite'

import baseConfig from '../../config/vite.lib.config'

const PWD = process.cwd()

export default defineConfig({
  ...baseConfig,
  test: {
    ...(baseConfig.test || {}),
    testTimeout: 30000,
    environment: 'node',
    include: [`${PWD}/tests/**/*.{spec,test}.{ts,tsx}`, `${PWD}/src/**/*.{spec,test}.{ts,tsx}`],
    typecheck: {
      tsconfig: './tsconfig.test.json'
    }
  }
})
