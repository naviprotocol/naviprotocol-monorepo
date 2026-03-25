import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

describe('public API type exports', () => {
  it('exports PTB option types from the package root', () => {
    expect(() =>
      execFileSync(
        pnpmExecutable,
        ['exec', 'tsc', '--pretty', 'false', '-p', 'tests/fixtures/public-api-types.tsconfig.json'],
        {
          cwd: process.cwd(),
          stdio: 'pipe'
        }
      )
    ).not.toThrow()
  })
})
