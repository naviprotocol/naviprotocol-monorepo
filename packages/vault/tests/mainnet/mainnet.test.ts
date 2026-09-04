/**
 * Mainnet integration entrypoint. Nothing is signed or submitted.
 *
 * Test cases are split by SDK interface in sibling *.cases.ts files. This
 * entrypoint owns the shared chain fixture and the single combined report.
 */
import { afterAll, afterEach, beforeAll } from 'vitest'
import { errorData, initializeMainnetContext, report } from './context'
import './all-vaults-config.cases'
import './cancel-pending-request-ptb.cases'
import './claim-rewards-ptb.cases'
import './deposit-ptb.cases'
import './error.cases'
import './get-pending-requests.cases'
import './get-positions.cases'
import './get-vault-info.cases'
import './get-vault-receipts.cases'
import './get-vaults.cases'
import './withdraw-ptb.cases'

beforeAll(initializeMainnetContext, 180_000)

afterEach((context) => {
  if (context.task.result?.state !== 'fail') return
  report.add({
    api: 'unknown',
    title: context.task.name,
    status: 'failed',
    purpose: 'Execute the live-chain test and collect its verification evidence.',
    data: { errors: context.task.result.errors?.map(errorData) },
    reason: 'The test failed before all expected evidence could be collected.'
  })
})

afterAll(async (suite) => {
  if (suite.result?.state === 'fail' && !report.hasFailures()) {
    report.add({
      api: 'suite',
      title: suite.name,
      status: 'failed',
      purpose: 'Prepare and execute the Vault SDK mainnet integration suite.',
      data: { errors: suite.result.errors?.map(errorData) },
      reason: 'Suite setup or teardown failed before an individual test could report evidence.'
    })
  }
  await report.write()
})
