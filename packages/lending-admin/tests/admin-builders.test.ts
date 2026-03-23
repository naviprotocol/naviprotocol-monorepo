import { describe, expect, it } from 'vitest'
import { Transaction } from '@mysten/sui/transactions'
import {
  defaultAdminConfig,
  borrowOnBehalfOfUserPTB,
  createFlashLoanAssetPTB,
  setPausePTB,
  createNewMarketPTB,
  createEModeAssetPTB,
  createIncentiveV3WithStoragePTB
} from '../src'

const getMoveTarget = (tx: Transaction, commandIndex: number) => {
  const data = tx.getData()
  const command = data.commands[commandIndex]
  if (!command || command.$kind !== 'MoveCall') {
    throw new Error('MoveCall not found at command index')
  }
  const call = command.MoveCall
  return `${call.package}::${call.module}::${call.function}`.toLowerCase()
}

const fullAddress = (suffix: string) => {
  return `0x${suffix.repeat(64)}`
}

describe('lending admin builders', () => {
  it('builds borrow on behalf v2 call', async () => {
    const tx = new Transaction()
    await borrowOnBehalfOfUserPTB(
      tx,
      {
        coinType: '0x2::sui::SUI',
        amount: 123,
        pool: fullAddress('a'),
        assetId: 0,
        user: '0xabc'
      },
      { config: defaultAdminConfig }
    )

    expect(getMoveTarget(tx, 0)).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000001::incentive_v3::entry_borrow_on_behalf_of_user_v2'
    )
  })

  it('builds pause call', async () => {
    const tx = new Transaction()
    await setPausePTB(tx, true, { config: defaultAdminConfig })
    expect(getMoveTarget(tx, 0)).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000001::storage::set_pause'
    )
  })

  it('builds create market call', async () => {
    const tx = new Transaction()
    await createNewMarketPTB(tx, { config: defaultAdminConfig })
    expect(getMoveTarget(tx, 0)).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000001::manage::create_new_market'
    )
  })

  it('builds create emode asset call', async () => {
    const tx = new Transaction()
    await createEModeAssetPTB(
      tx,
      {
        assetId: 8,
        isCollateral: true,
        isDebt: true,
        ltv: 8000,
        lt: 8500,
        liquidationBonus: 10500
      },
      { config: defaultAdminConfig }
    )
    expect(getMoveTarget(tx, 0)).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000001::manage::create_emode_asset'
    )
  })

  it('builds flashloan asset call', async () => {
    const tx = new Transaction()
    await createFlashLoanAssetPTB(
      tx,
      {
        coinType: '0x2::sui::SUI',
        pool: fullAddress('b'),
        assetId: 0,
        rateToSupplier: 5000,
        rateToTreasury: 5000,
        maximum: 1_000_000,
        minimum: 1_000
      },
      { config: defaultAdminConfig }
    )
    expect(getMoveTarget(tx, 0)).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000001::manage::create_flash_loan_asset'
    )
  })

  it('builds create incentive v3 call', async () => {
    const tx = new Transaction()
    await createIncentiveV3WithStoragePTB(tx, defaultAdminConfig.storage, {
      config: defaultAdminConfig
    })
    expect(getMoveTarget(tx, 0)).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000001::manage::create_incentive_v3_with_storage'
    )
  })
})
