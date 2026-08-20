import type { NAVILendingVault, VaultReward, VoloVault } from '../src'

const CALL_TARGET = '0x13e1e0ddcf3a76cde006d530e98a0f985c446013cfedeae6dd067a2f1ea88ff5'
const TYPE_PACKAGE = '0x51cecaacaed0bd436f04ebbd8ba0ca1627c9c4d0e54ad28eff095ca78591518c'
export const CERT = '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT'

/**
 * SUI High Yield as configured on mainnet: three markets and one active CERT market rule.
 * The most complex live shape — a deposit here is 3 syncs + 1 harvest + 1 deposit.
 */
export function suiHighYield(): NAVILendingVault {
  return {
    id: '0x864527a8ed2435aed828b46c6d9d0244506b418761cca25b7dd47a83c7797a29',
    app: 'navi',
    protocol: 'navi-lending',
    operatorMode: 'instant',
    assets: {
      base: { coinType: '0x2::sui::SUI', decimals: 9 },
      deposits: [{ coinType: '0x2::sui::SUI', decimals: 9 }]
    },
    contractConfig: {
      env: 'prod',
      schemaVersion: 1,
      package: CALL_TARGET,
      initialPackageId: TYPE_PACKAGE,
      clockObjectId: '0x6',
      naviLending: {
        timelockObjectId: '0x04523a8d1f1a3019f9b8f5e61984544d5dfc467ec0e91d64f228a17e30737264',
        oraclePackageId: '0x4837ae94425107554c8847721cf9954c1ad8e10520433b9e37dc11c507148bea',
        oracleConfigObjectId: '0x1afe1cb83634f581606cc73c4487ddd8cc39a944b951283af23f7d69d5589478',
        priceOracleObjectId: '0x1568865ed9a0b5ec414220e8f79b3d04c77acc82358f6e5ae4635687392ffbef',
        suiSystemStateObjectId: '0x5',
        defaultMarketCode: 'main',
        markets: [
          {
            code: 'main',
            poolObjectId: '0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5',
            storageObjectId: '0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe',
            assetId: 0,
            incentiveV2ObjectId:
              '0xf87a8acb8b81d14307894d12595541a73f19933f88e1326d5be349c7a6f7559c',
            incentiveV3ObjectId:
              '0x62982dad27fb10bb314b3384d5de8d2ac2d72ab2dbeae5d801dbdb9efa816c80'
          },
          {
            code: 'suieco',
            poolObjectId: '0xc1dfd32ec30a1ba16e8c1d32a284718ac8f41765722f27fe7fb9d0b38a570ae0',
            storageObjectId: '0xdf18372bc9c588b96c7553bc811467a9166ed9be472b40cb45c226175377c558',
            assetId: 0,
            incentiveV2ObjectId:
              '0xf87a8acb8b81d14307894d12595541a73f19933f88e1326d5be349c7a6f7559c',
            incentiveV3ObjectId:
              '0x5ddc7f50eff9396f3f401a6194dda7b64c2ffc64fd581d119c44ae0587119309'
          },
          {
            code: 'vsui-sui',
            poolObjectId: '0x3f2d878005dd9d5caf56467bc0c55f93bb5a3c83a5c7fb057032a0abf1bad4bf',
            storageObjectId: '0xafb982de1a436b1cc8a14ecd2d787762599b65d3a6b75b84b10939b1e17d9381',
            assetId: 1,
            incentiveV2ObjectId:
              '0xf87a8acb8b81d14307894d12595541a73f19933f88e1326d5be349c7a6f7559c',
            incentiveV3ObjectId:
              '0x5a1d3333b37d206033bb49859d306e546cc8d9b81a0c854d899752227a91a2de'
          }
        ],
        rewardRules: [
          {
            ruleIndex: 0,
            type: 'market',
            active: true,
            rewardCoinType: CERT,
            naviPoolId: '0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5',
            incentiveRuleId: '0xd483f186fa678d5f93912f5960f97f29796c12902245b79b9b7a87a4ca407e5a',
            rewardFundObjectId:
              '0x7093cf7549d5e5b35bfde2177223d1050f71655c7f676a5e610ee70eb4d93b5c',
            storageObjectId: '0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe',
            incentiveV3ObjectId:
              '0x62982dad27fb10bb314b3384d5de8d2ac2d72ab2dbeae5d801dbdb9efa816c80'
          }
        ]
      }
    }
  }
}

/** SUI Prime: two markets, no reward rules. A deposit is 2 syncs + 1 deposit. */
export function suiPrime(): NAVILendingVault {
  const vault = suiHighYield()
  return {
    ...vault,
    id: '0x01236ff6c66c0c668950f9702629b42f372bf478793d055d2a7eca15e0b0d1e7',
    contractConfig: {
      ...vault.contractConfig,
      naviLending: {
        ...vault.contractConfig.naviLending,
        defaultMarketCode: 'vsui-sui',
        markets: vault.contractConfig.naviLending.markets.slice(1),
        rewardRules: []
      }
    }
  }
}

export const OWNER = `0x${'a'.repeat(64)}`
export const RECEIPT = `0x${'b'.repeat(64)}`

export function certReward(receiptId = RECEIPT): VaultReward {
  return {
    vaultId: suiHighYield().id,
    owner: OWNER,
    receiptId,
    rewardCoinType: CERT,
    claimable: '5701103'
  }
}

/**
 * Client stub for offline tests.
 *
 * - `listOwnedObjects` returns the given receipts
 * - `listCoins` returns one large coin so non-SUI deposits can be built
 * - `simulateTransaction` answers every command with a `u64`, taken from `balances` by
 *   receipt in the order they were passed — enough for `get_user_balance` reads
 */
export function clientWithReceipts(
  receiptIds: string[],
  balances: Record<string, bigint> = {},
  vaultId = suiHighYield().id
) {
  return {
    core: {
      listOwnedObjects: async () => ({
        objects: receiptIds.map((objectId) => ({
          objectId,
          content: receiptContent(objectId, vaultId)
        })),
        cursor: null,
        hasNextPage: false
      }),
      listCoins: async () => ({
        objects: [{ objectId: `0x${'9'.repeat(64)}`, balance: '1000000000000' }],
        cursor: null,
        hasNextPage: false
      }),
      simulateTransaction: async () => ({
        Transaction: {},
        commandResults: receiptIds.map((receiptId) => ({
          returnValues: [{ bcs: u64Bytes(balances[receiptId] ?? 0n) }]
        }))
      })
    }
  } as never
}

function u64Bytes(value: bigint): Uint8Array {
  const out = new Uint8Array(8)
  let rest = value
  for (let i = 0; i < 8; i += 1) {
    out[i] = Number(rest & 0xffn)
    rest >>= 8n
  }
  return out
}

function receiptContent(objectId: string, vaultId: string): Uint8Array {
  const hex = (value: string) => value.replace(/^0x/, '').padStart(64, '0')
  return Uint8Array.from(Buffer.from(hex(objectId) + hex(vaultId), 'hex'))
}

const VOLO_CALL_TARGET = `0x${'e'.repeat(64)}`
const VOLO_TYPE_PACKAGE = `0x${'f'.repeat(64)}`
export const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
export const USDT = '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT'

/**
 * A Volo vault shaped like the production "Stable MMT" entries: USDC principal, with USDT
 * additionally accepted as a non-principal deposit asset.
 */
export function voloStable(): VoloVault {
  return {
    id: `0x${'1'.repeat(64)}`,
    app: 'volo',
    protocol: 'volo-vault',
    operatorMode: 'eventual',
    assets: {
      base: { coinType: USDC, decimals: 6 },
      deposits: [
        { coinType: USDC, decimals: 6 },
        { coinType: USDT, decimals: 6 }
      ]
    },
    contractConfig: {
      env: 'prod',
      schemaVersion: 1,
      package: VOLO_CALL_TARGET,
      initialPackageId: VOLO_TYPE_PACKAGE,
      clockObjectId: '0x6',
      volo: {
        vaultCode: 'stable-mmt-1',
        rewardManagerObjectId: `0x${'2'.repeat(64)}`,
        receiptParentObjectId: `0x${'3'.repeat(64)}`,
        configObjectId: `0x${'4'.repeat(64)}`,
        stakingObjectId: `0x${'5'.repeat(64)}`
      }
    }
  }
}

export function voloReward(receiptId = RECEIPT): VaultReward {
  return {
    vaultId: voloStable().id,
    owner: OWNER,
    receiptId,
    rewardCoinType: CERT,
    claimable: '1000'
  }
}
