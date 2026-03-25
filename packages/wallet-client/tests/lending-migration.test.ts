import './fetch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeStructTag } from '@mysten/sui/utils'
import { Transaction } from '@mysten/sui/transactions'
import { buildSwapPTBFromQuote } from '@naviprotocol/astros-aggregator-sdk'
import { getCoins } from '@naviprotocol/lending'
import { createMockWalletClient, fakeCoin, getMoveTargets } from './test-utils'

let mockedCoins: any[] = []

vi.mock('@naviprotocol/astros-aggregator-sdk', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    buildSwapPTBFromQuote: vi.fn(async (_address: string, tx: Transaction) => {
      return tx.object('0x777') as any
    })
  }
})

vi.mock('@naviprotocol/lending', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    getPriceFeeds: vi.fn(async () => []),
    filterPriceFeeds: vi.fn(() => []),
    updateOraclePricesPTB: vi.fn(async (tx: Transaction) => {
      tx.moveCall({
        target: '0x2::stub::update_oracle',
        arguments: [],
        typeArguments: []
      })
    }),
    getFlashLoanAsset: vi.fn(async () => ({
      flashloanFee: 0.01
    })),
    flashloanPTB: vi.fn(async (tx: Transaction) => {
      const [balance] = tx.splitCoins(tx.gas, [tx.pure.u64(1)])
      return [balance, tx.object('0x701')]
    }),
    depositCoinPTB: vi.fn(async (tx: Transaction) => {
      tx.moveCall({
        target: '0x2::stub::deposit',
        arguments: [],
        typeArguments: []
      })
    }),
    repayFlashLoanPTB: vi.fn(async (tx: Transaction) => {
      const [balance] = tx.splitCoins(tx.gas, [tx.pure.u64(1)])
      return [balance]
    }),
    borrowCoinPTB: vi.fn(async (tx: Transaction) => {
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(1)])
      return coin
    }),
    getCoins: vi.fn(async () => mockedCoins)
  }
})

const testAddress = '0x4a662a70184c9e8f62e9d298c9969318a74cec5e9d3b5e0616a687052e654e57'
const walletClient = createMockWalletClient(testAddress)
const suilendWalletClient = createMockWalletClient(testAddress)

const usdyCoinType =
  '0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY'
const usdtCoinType =
  '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN'
const vsuiCoinType =
  '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT'
const hasuiCoinType =
  '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI'
const suilendUsdcCoinType =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
const suiCoinType = normalizeStructTag('0x2::sui::SUI')

const poolsByCoinType = {
  [normalizeStructTag(usdyCoinType)]: {
    id: 101,
    coinType: usdyCoinType,
    suiCoinType: usdyCoinType,
    token: {
      decimals: 6,
      symbol: 'USDY'
    }
  },
  [normalizeStructTag(usdtCoinType)]: {
    id: 102,
    coinType: usdtCoinType,
    suiCoinType: usdtCoinType,
    token: {
      decimals: 6,
      symbol: 'USDT'
    }
  },
  [normalizeStructTag(vsuiCoinType)]: {
    id: 5,
    coinType: vsuiCoinType,
    suiCoinType: vsuiCoinType,
    token: {
      decimals: 9,
      symbol: 'vSUI'
    }
  },
  [normalizeStructTag(hasuiCoinType)]: {
    id: 6,
    coinType: hasuiCoinType,
    suiCoinType: hasuiCoinType,
    token: {
      decimals: 9,
      symbol: 'haSUI'
    }
  },
  [normalizeStructTag(suilendUsdcCoinType)]: {
    id: 103,
    coinType: suilendUsdcCoinType,
    suiCoinType: suilendUsdcCoinType,
    token: {
      decimals: 6,
      symbol: 'USDC'
    }
  },
  [normalizeStructTag(suiCoinType)]: {
    id: 0,
    coinType: suiCoinType,
    suiCoinType,
    token: {
      decimals: 9,
      symbol: 'SUI'
    }
  }
} as const

function createProtocol(name: 'navi' | 'suilend', balances: Record<string, any>) {
  return {
    name,
    getPool: vi.fn(async (coinType: string) => {
      return (
        balances[normalizeStructTag(coinType)] ?? {
          supplyBalance: 0,
          borrowBalance: 0,
          borrowAPR: 5
        }
      )
    }),
    depositCoinPTB: vi.fn(async () => undefined),
    withdrawCoinPTB: vi.fn(async (tx: Transaction) => tx.object('0x801') as any),
    borrowCoinPTB: vi.fn(async (tx: Transaction) => {
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(1)])
      return coin
    }),
    repayCoinPTB: vi.fn(async (tx: Transaction) => {
      tx.moveCall({
        target: '0x2::stub::protocol_repay',
        arguments: [],
        typeArguments: []
      })
    })
  }
}

function installLendingMocks(
  client: typeof walletClient,
  protocolBalances: Record<string, any>,
  protocolName: 'navi' | 'suilend' = 'navi'
) {
  const naviProtocol = createProtocol('navi', protocolBalances)
  const suilendProtocol = createProtocol('suilend', protocolBalances)
  const protocolByName = {
    navi: naviProtocol,
    suilend: suilendProtocol
  }

  vi.spyOn(client.lending, 'getPool').mockImplementation(async (identifier: any) => {
    return poolsByCoinType[normalizeStructTag(String(identifier))] as any
  })
  vi.spyOn(client.lending, 'getLendingState').mockResolvedValue([] as any)
  vi.spyOn(client.lending, 'getProtocol').mockImplementation(async (name: string) => {
    return protocolByName[(name as 'navi' | 'suilend') ?? protocolName]
  })
  vi.spyOn(client.swap, 'getQuote').mockImplementation(async (fromCoinType: string) => {
    const normalizedFrom = normalizeStructTag(fromCoinType)

    if (normalizedFrom === normalizeStructTag(vsuiCoinType)) {
      return {
        amount_out: '300000000'
      } as any
    }

    if (normalizedFrom === normalizeStructTag(usdyCoinType)) {
      return {
        amount_out: '1100000'
      } as any
    }

    if (normalizedFrom === normalizeStructTag(suiCoinType)) {
      return {
        amount_out: '310000000'
      } as any
    }

    return {
      amount_out: '1000000000'
    } as any
  })
  vi.spyOn(client.swap, 'buildSwapPTBFromQuote').mockImplementation(async (tx: Transaction) => {
    return tx.object('0x991') as any
  })

  return {
    naviProtocol,
    suilendProtocol
  }
}

describe('lending migration PTBs', () => {
  beforeEach(() => {
    mockedCoins = []
    vi.restoreAllMocks()
  })

  afterEach(() => {
    mockedCoins = []
    vi.restoreAllMocks()
  })

  it('builds navi supply migration PTB', async () => {
    installLendingMocks(walletClient, {
      [normalizeStructTag(usdyCoinType)]: {
        supplyBalance: 10308759791,
        borrowBalance: 0,
        borrowAPR: 5.236
      }
    })

    const tx = new Transaction()
    await walletClient.lending.migrateBetweenSupplyPTB(tx, usdyCoinType, usdtCoinType, {
      amount: 1e6,
      slippage: 0.002
    })

    expect(walletClient.swap.getQuote).toHaveBeenCalledWith(usdyCoinType, usdtCoinType, 1e6)
    expect(buildSwapPTBFromQuote).toHaveBeenCalled()
    expect(getMoveTargets(tx)).toContain(
      '0x0000000000000000000000000000000000000000000000000000000000000002::stub::update_oracle'
    )
    expect(getMoveTargets(tx)).toContain(
      '0x0000000000000000000000000000000000000000000000000000000000000002::stub::deposit'
    )
  })

  it('builds navi borrow migration PTB', async () => {
    const { naviProtocol } = installLendingMocks(walletClient, {
      [normalizeStructTag(vsuiCoinType)]: {
        supplyBalance: 1472862787,
        borrowBalance: 685582154,
        borrowAPR: 0.407
      }
    })

    const tx = new Transaction()
    await walletClient.lending.migrateBetweenBorrowPTB(tx, vsuiCoinType, hasuiCoinType, {
      amount: 255687914,
      slippage: 0.002
    })

    expect(walletClient.swap.getQuote).toHaveBeenCalledTimes(2)
    expect(naviProtocol.repayCoinPTB).toHaveBeenCalled()
    expect(buildSwapPTBFromQuote).toHaveBeenCalled()
    expect(getMoveTargets(tx)).toContain(
      '0x0000000000000000000000000000000000000000000000000000000000000002::stub::protocol_repay'
    )
    expect(tx.getData().commands.some((command: any) => command.$kind === 'TransferObjects')).toBe(
      true
    )
  })

  it('builds balance-to-supply migration PTB from wallet balance', async () => {
    installLendingMocks(walletClient, {})
    mockedCoins = [fakeCoin('0x91', vsuiCoinType, '973139597')]

    const tx = new Transaction()
    await walletClient.lending.migrateBalanceToSupplyPTB(tx, vsuiCoinType, usdtCoinType, {
      amount: 973139597,
      slippage: 0.002
    })

    expect(getCoins).toHaveBeenCalledWith(testAddress, {
      client: walletClient.client,
      coinType: vsuiCoinType
    })
    expect(walletClient.swap.buildSwapPTBFromQuote).toHaveBeenCalled()
    expect(getMoveTargets(tx)).toContain(
      '0x0000000000000000000000000000000000000000000000000000000000000002::stub::deposit'
    )
  })

  it('builds cross-protocol supply migration PTB', async () => {
    const { suilendProtocol } = installLendingMocks(suilendWalletClient, {
      [normalizeStructTag(suilendUsdcCoinType)]: {
        supplyBalance: 32558907,
        borrowBalance: 0,
        borrowAPR: 5.509862030197116
      }
    })

    const tx = new Transaction()
    await suilendWalletClient.lending.migrateBetweenSupplyPTB(
      tx,
      suilendUsdcCoinType,
      usdtCoinType,
      {
        protocol: 'suilend',
        amount: 1e6,
        slippage: 0.002
      }
    )

    expect(suilendWalletClient.swap.getQuote).toHaveBeenCalledWith(
      suilendUsdcCoinType,
      usdtCoinType,
      1e6
    )
    expect(suilendProtocol.withdrawCoinPTB).toHaveBeenCalled()
    expect(buildSwapPTBFromQuote).toHaveBeenCalled()
    expect(getMoveTargets(tx)).toContain(
      '0x0000000000000000000000000000000000000000000000000000000000000002::stub::deposit'
    )
  })

  it('builds cross-protocol borrow migration PTB', async () => {
    const { suilendProtocol } = installLendingMocks(suilendWalletClient, {
      [normalizeStructTag(suiCoinType)]: {
        supplyBalance: 0,
        borrowBalance: 1344088461,
        borrowAPR: 5.679319988541489
      }
    })

    const tx = new Transaction()
    await suilendWalletClient.lending.migrateBetweenBorrowPTB(tx, suiCoinType, hasuiCoinType, {
      protocol: 'suilend',
      amount: 300000000,
      slippage: 0.01
    })

    expect(suilendWalletClient.swap.getQuote).toHaveBeenCalledTimes(2)
    expect(suilendProtocol.repayCoinPTB).toHaveBeenCalled()
    expect(buildSwapPTBFromQuote).toHaveBeenCalled()
    expect(tx.getData().commands.some((command: any) => command.$kind === 'TransferObjects')).toBe(
      true
    )
  })
})
