import { getConfig, getPool } from '@naviprotocol/lending'
import { VaultSdkError } from '../../errors'
import type { NAVILendingVault } from '../../vaults'

/** A market with the lending-side objects its Move calls take. */
export type ResolvedMarket = {
  code: string
  isDefault: boolean
  poolObjectId: string
  storageObjectId: string
  incentiveV2ObjectId: string
  incentiveV3ObjectId: string
  /** `RewardFund` per reward coin type, for this market. */
  rewardFunds: Record<string, string>
}

/**
 * Resolves each of the vault's markets against `@naviprotocol/lending`.
 *
 * `Storage`, `IncentiveV2`, `IncentiveV3`, the pool and the `RewardFund`s all belong to the
 * lending side, which publishes them per market. Reading them here rather than taking them
 * from vault configuration keeps one source: a lending object that moves is picked up
 * without a release here or a config update anywhere.
 *
 * Both lending calls are cached inside that package and keyed by market, so a vault sharing
 * a market with one already read costs nothing.
 */
export async function resolveMarkets(
  vault: NAVILendingVault,
  options: { env: 'dev' | 'prod' }
): Promise<ResolvedMarket[]> {
  return Promise.all(
    vault.contractConfig.naviLending.markets.map(async (market) => {
      const [config, pool] = await Promise.all([
        getConfig({ ...options, market: market.code }),
        getPool(vault.assets.base.coinType, { ...options, market: market.code })
      ]).catch((error) => {
        throw new VaultSdkError(
          'VAULT_CONFIG_INVALID',
          `Cannot resolve market "${market.code}" of vault ${vault.id} against ` +
            `@naviprotocol/lending. Either the code is not one of the keys ` +
            `/api/navi/markets serves, or that market has no pool for ` +
            `${vault.assets.base.coinType}.`,
          { cause: error }
        )
      })

      return {
        code: market.code,
        isDefault: market.isDefault,
        poolObjectId: pool.contract.pool,
        storageObjectId: config.storage,
        incentiveV2ObjectId: config.incentiveV2,
        incentiveV3ObjectId: config.incentiveV3,
        rewardFunds: config.rewardFunds ?? {}
      }
    })
  )
}

export function marketCodes(markets: ResolvedMarket[]): string {
  return markets.map((market) => market.code).join(', ')
}

export function defaultMarket(vault: NAVILendingVault, markets: ResolvedMarket[]): ResolvedMarket {
  const market = markets.find((candidate) => candidate.isDefault)
  if (!market) {
    throw new VaultSdkError(
      'VAULT_CONFIG_INVALID',
      `None of vault ${vault.id}'s markets (${marketCodes(markets)}) is flagged default. ` +
        `Deposits route only to the default market, and withdrawing from any other one is ` +
        `penalised.`
    )
  }
  return market
}
