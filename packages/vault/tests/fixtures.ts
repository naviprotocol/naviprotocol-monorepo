import { MAINNET_VAULT_CONFIG, MarketStatus } from '../src'
import type { MarketLayout, RewardRuleLayout, VaultDescriptor, VaultLayout } from '../src'

export const CONFIG = MAINNET_VAULT_CONFIG

export function descriptor(key: string): VaultDescriptor {
  const found = CONFIG.vaults.find((vault) => vault.key === key)
  if (!found) throw new Error(`no fixture vault ${key}`)
  return found
}

export function market(
  overrides: Partial<MarketLayout> & Pick<MarketLayout, 'poolId'>
): MarketLayout {
  return {
    cap: 0n,
    penalty: 20_000_000_000_000_000n,
    loss: 0n,
    status: MarketStatus.Active,
    lastSyncAtMs: 0n,
    storageId: `0x${'a'.repeat(64)}`,
    assetId: 0,
    incentiveV3Id: `0x${'b'.repeat(64)}`,
    incentiveV2Id: `0x${'c'.repeat(64)}`,
    currentBalance: 0n,
    ...overrides
  }
}

export function rule(
  overrides: Partial<RewardRuleLayout> & Pick<RewardRuleLayout, 'index'>
): RewardRuleLayout {
  return {
    naviPoolId: `0x${'0'.repeat(64)}`,
    rewardCoinType: '0x2::sui::SUI',
    incentiveRuleId: `0x${'0'.repeat(64)}`,
    vaultRewardIndex: 0n,
    lastHarvestAtMs: 0n,
    isVaultNative: false,
    rewardRate: 0n,
    isActive: true,
    totalRewardDeposited: 0n,
    totalRewardDistributed: 0n,
    ...overrides
  }
}

/**
 * Layout mirroring USDC High Yield: five markets and two rules, one of which is an
 * inactive vault-native rule with zeroed ids. The most complex live shape.
 */
export function usdcHighYieldLayout(): VaultLayout {
  const descriptorUsdc = descriptor('USDC')
  return {
    markets: descriptorUsdc.markets.map((entry) =>
      market({
        poolId: entry.pool,
        storageId: entry.storage,
        incentiveV3Id: entry.incentiveV3,
        assetId: entry.assetId,
        currentBalance: 1_000_000n
      })
    ),
    rules: [
      rule({
        index: 0,
        naviPoolId: descriptorUsdc.markets[0]!.pool,
        rewardCoinType:
          '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
        isActive: true,
        isVaultNative: false
      }),
      rule({ index: 1, isActive: false, isVaultNative: true })
    ],
    defaultMarket: descriptorUsdc.markets[0]!.pool,
    paused: false,
    version: 2n,
    vaultCap: 10_000_000_000_000n,
    managementFee: 0n,
    performanceFee: 50_000_000_000_000_000n,
    idleBalance: 500_000n,
    totalShares: 5_000_000n
  }
}
