import { CoinStruct, getFullnodeUrl } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'
import { vi } from 'vitest'
import { WalletClient, WatchSigner } from '../src'
import { UserPortfolio } from '../src/modules/balanceModule/portfolio'

export function createMockWalletClient(
  address = '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'
) {
  return new WalletClient({
    signer: new WatchSigner(address),
    client: {
      url: getFullnodeUrl('mainnet')
    },
    configs: {
      balance: {
        disableCoinPolling: true
      }
    }
  })
}

export function fakeCoin(coinObjectId: string, coinType: string, balance: string): CoinStruct {
  return {
    coinObjectId,
    balance,
    coinType,
    digest: coinObjectId,
    previousTransaction: coinObjectId,
    version: '1'
  }
}

export function setMockPortfolio(walletClient: WalletClient, coins: CoinStruct[]) {
  const balanceModule = walletClient.module('balance') as any
  balanceModule._portfolio = new UserPortfolio(coins)
  balanceModule.waitForUpdate = vi.fn().mockResolvedValue(undefined)
}

export function mockDryRunSuccess(
  walletClient: WalletClient,
  onTransaction?: (tx: Transaction) => void
) {
  const spy = vi.fn(async ({ transaction }: { transaction: Uint8Array | Transaction }) => {
    if (transaction instanceof Transaction) {
      onTransaction?.(transaction)
    }
    return {
      effects: {
        status: {
          status: 'success'
        }
      },
      events: [
        {
          type: '0x0::test::event',
          parsedJson: {}
        }
      ]
    } as any
  })

  ;(walletClient as any).signExecuteTransaction = spy
  return spy
}

export function getMoveTargets(tx: Transaction) {
  return tx
    .getData()
    .commands.filter((command: any) => command.$kind === 'MoveCall')
    .map((command: any) => {
      const moveCall = command.MoveCall
      return `${moveCall.package}::${moveCall.module}::${moveCall.function}`
    })
}
