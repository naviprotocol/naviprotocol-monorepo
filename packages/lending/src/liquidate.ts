import { AssetIdentifier, CoinObject, EnvOption, TransactionResult } from './types'
import { Transaction } from '@mysten/sui/transactions'
import { DEFAULT_CACHE_TIME, getConfig } from './config'
import { getPool } from './pool'
import { getAllFlashLoanAssets } from './flashloan'
import { normalizeCoinType, parseTxVaule } from './utils'

export async function liquidatePTB(
  tx: Transaction,
  payAsset: AssetIdentifier,
  payCoinObject: CoinObject,
  collateralAsset: AssetIdentifier,
  liquidateAddress: string | TransactionResult,
  options?: Partial<EnvOption>
) {
  const commonOptions = {
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  }
  const config = await getConfig(commonOptions)
  const payPool = await getPool(payAsset, commonOptions)
  const collateralPool = await getPool(collateralAsset, commonOptions)

  const flashLoanAssets = await getAllFlashLoanAssets(commonOptions)

  const isSupportPay = flashLoanAssets.some(
    (asset) => normalizeCoinType(asset.coinType) === normalizeCoinType(payPool.suiCoinType)
  )

  if (!isSupportPay) {
    throw new Error('Pay asset does not support flashloan')
  }

  const isSupportCollateral = flashLoanAssets.some(
    (asset) => normalizeCoinType(asset.coinType) === normalizeCoinType(collateralPool.suiCoinType)
  )

  if (!isSupportCollateral) {
    throw new Error('Collateral asset does not support flashloan')
  }

  const [collateralBalance, remainDebtBalance] = tx.moveCall({
    target: `${config.package}::incentive_v3::liquidation`,
    arguments: [
      tx.object('0x06'),
      tx.object(config.priceOracle),
      tx.object(config.storage),
      tx.pure.u8(payPool.id),
      tx.object(payPool.contract.pool),
      parseTxVaule(payCoinObject, tx.object),
      tx.pure.u8(collateralPool.id),
      tx.object(collateralPool.contract.pool),
      parseTxVaule(liquidateAddress, tx.pure.address),
      tx.object(config.incentiveV2),
      tx.object(config.incentiveV3)
    ],
    typeArguments: [payPool.suiCoinType, collateralPool.suiCoinType]
  })

  return [collateralBalance, remainDebtBalance]
}
