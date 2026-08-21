import type { NAVILendingVault, VaultReward, VoloVault } from '../src'

const CALL_TARGET = '0x13e1e0ddcf3a76cde006d530e98a0f985c446013cfedeae6dd067a2f1ea88ff5'
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
      base: { coinType: '0x2::sui::SUI' }
    },
    contractConfig: {
      package: CALL_TARGET,
      naviLending: {
        markets: [
          {
            code: 'main',
            isDefault: true,
            poolObjectId: '0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5',
            storageObjectId: '0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe',
            incentiveV2ObjectId:
              '0xf87a8acb8b81d14307894d12595541a73f19933f88e1326d5be349c7a6f7559c',
            incentiveV3ObjectId:
              '0x62982dad27fb10bb314b3384d5de8d2ac2d72ab2dbeae5d801dbdb9efa816c80'
          },
          {
            code: 'sui-eco',
            isDefault: false,
            poolObjectId: '0xc1dfd32ec30a1ba16e8c1d32a284718ac8f41765722f27fe7fb9d0b38a570ae0',
            storageObjectId: '0xdf18372bc9c588b96c7553bc811467a9166ed9be472b40cb45c226175377c558',
            incentiveV2ObjectId:
              '0xf87a8acb8b81d14307894d12595541a73f19933f88e1326d5be349c7a6f7559c',
            incentiveV3ObjectId:
              '0x5ddc7f50eff9396f3f401a6194dda7b64c2ffc64fd581d119c44ae0587119309'
          },
          {
            code: 'vsui-sui',
            isDefault: false,
            poolObjectId: '0x3f2d878005dd9d5caf56467bc0c55f93bb5a3c83a5c7fb057032a0abf1bad4bf',
            storageObjectId: '0xafb982de1a436b1cc8a14ecd2d787762599b65d3a6b75b84b10939b1e17d9381',
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
            rewardFundObjectId: '0x7093cf7549d5e5b35bfde2177223d1050f71655c7f676a5e610ee70eb4d93b5c'
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
        markets: vault.contractConfig.naviLending.markets
          .slice(1)
          .map((market) => ({ ...market, isDefault: market.code === 'vsui-sui' })),
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
export const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'

/** A Volo vault shaped like the production "Stable MMT" entries: USDC principal. */
export function voloStable(): VoloVault {
  return {
    id: `0x${'1'.repeat(64)}`,
    app: 'volo',
    protocol: 'volo-vault',
    operatorMode: 'eventual',
    assets: {
      base: { coinType: USDC }
    },
    contractConfig: {
      package: VOLO_CALL_TARGET,
      volo: {
        rewardManagerObjectId: `0x${'2'.repeat(64)}`,
        receiptParentObjectId: `0x${'3'.repeat(64)}`
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

const WBTC = '0xaafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC'

/**
 * The live Volo wBTC vault, for tests that hit mainnet.
 *
 * `package` is the current call target (UpgradeCap version 11) and `receiptParentObjectId`
 * is the vault's own `receipts` Table, both read back from chain.
 */
export function voloWbtcMainnet(): VoloVault {
  return {
    id: '0x6e53ffe5b77a85ff609b0813955866ec98a072e4aaf628108e717143ec907bd8',
    app: 'volo',
    protocol: 'volo-vault',
    operatorMode: 'eventual',
    assets: { base: { coinType: WBTC } },
    contractConfig: {
      package: '0xfba9e78742d8f3edeb405561b954846ce3e60cab64dac00e600d50bb4923be0f',
      volo: {
        receiptParentObjectId: '0x72da674ce792a5222eda32ffb4d9a8798f91766196fc44c206fc59dc5c60504c',
        rewardManagerObjectId: '0xf5c28be9086c576dc18c66a6791984c07136131f031ad14b3576890327af4d73'
      }
    }
  }
}
