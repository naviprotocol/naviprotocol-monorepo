import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('vite.config.unit.js', () => {
  it('uses process.cwd when PWD is undefined', async () => {
    const originalPwd = process.env.PWD

    try {
      delete process.env.PWD

      const moduleUrl = pathToFileURL(resolve(process.cwd(), 'vite.config.unit.js')).href
      const { default: config } = await import(`${moduleUrl}?t=${Date.now()}`)

      expect(config.test?.include).toEqual([
        `${process.cwd()}/tests/**/*.{spec,test}.{ts,tsx}`,
        `${process.cwd()}/src/**/*.{spec,test}.{ts,tsx}`
      ])
    } finally {
      if (typeof originalPwd === 'undefined') {
        delete process.env.PWD
      } else {
        process.env.PWD = originalPwd
      }
    }
  })
})
