import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'

import { buildSwapPTBFromQuote, getQuote } from '@naviprotocol/astros-aggregator-sdk'
import { createDcaOrder, TimeUnit } from '@naviprotocol/astros-dca-sdk'
import { depositCoinPTB, getCoins, getLendingState } from '@naviprotocol/lending'
import { WalletClient, WatchSigner, type NaviDryRunTransactionResult } from '../../dist/index'

const address = '0x0000000000000000000000000000000000000000000000000000000000000001'
const suiCoinType = '0x2::sui::SUI'
const navxCoinType =
  '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX'

const client = new SuiJsonRpcClient({
  network: 'mainnet',
  url: getJsonRpcFullnodeUrl('mainnet')
})

const walletClient = new WalletClient({
  signer: new WatchSigner(address),
  client: {
    network: 'mainnet',
    grpc: {
      url: 'https://grpc.mainnet.sui.example'
    },
    legacyJsonRpc: {
      url: getJsonRpcFullnodeUrl('mainnet')
    }
  }
})

async function lendingReadExample() {
  await getCoins(address, { client })
  await getLendingState(address, { client })
}

async function lendingPtbExample() {
  const tx = new Transaction()
  const [coin] = tx.splitCoins(tx.gas, [1_000_000n])

  await depositCoinPTB(tx, suiCoinType, coin, {
    amount: 1_000_000
  })
}

async function walletClientDryRunExample() {
  const dryRun: NaviDryRunTransactionResult = await walletClient.balance.sendCoin(
    suiCoinType,
    address,
    1_000_000,
    { dryRun: true }
  )

  dryRun.kind satisfies 'dryRun'
  dryRun.effects?.status?.status satisfies string | undefined
}

async function aggregatorPtbExample() {
  const tx = new Transaction()
  const coinIn = tx.splitCoins(tx.gas, [1_000_000n])
  const quote = await getQuote(suiCoinType, navxCoinType, 1_000_000)

  const coinOut = await buildSwapPTBFromQuote(address, tx, 990_000, coinIn, quote, 0, false)
  tx.transferObjects([coinOut], address)
}

async function dcaExample() {
  const tx = await createDcaOrder(client, address, {
    fromCoinType: suiCoinType,
    toCoinType: navxCoinType,
    depositedAmount: '1500000000',
    totalExecutions: 10,
    frequency: {
      value: 1,
      unit: TimeUnit.HOUR
    },
    priceRange: {
      minBuyPrice: 18000000,
      maxBuyPrice: 25000000
    }
  })

  tx satisfies Transaction
}

void lendingReadExample
void lendingPtbExample
void walletClientDryRunExample
void aggregatorPtbExample
void dcaExample
