import { getJsonRpcFullnodeUrl, SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'
import {
  dryRunSwapTransaction,
  getQuote as getSwapQuote,
  type Quote
} from '@naviprotocol/astros-aggregator-sdk'
import {
  getQuote as getBridgeQuote,
  getTransaction as getBridgeTransaction,
  swap as bridgeSwap,
  type BridgeSwapQuote,
  type Token
} from '@naviprotocol/astros-bridge-sdk'
import {
  cancelDcaOrder,
  createDcaOrder,
  dryRunDcaTransaction,
  TimeUnit
} from '@naviprotocol/astros-dca-sdk'
import {
  createNaviSuiClient,
  SuiPriceServiceConnection,
  SuiPythClient
} from '@naviprotocol/lending'
import { WalletClient, WatchSigner } from '@naviprotocol/wallet-client'

const userAddress = '0x0000000000000000000000000000000000000000000000000000000000000001'
const suiCoinType = '0x2::sui::SUI'
const navxCoinType =
  '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX'

const client = createNaviSuiClient()
const customClient = new SuiJsonRpcClient({
  network: 'mainnet',
  url: getJsonRpcFullnodeUrl('mainnet')
})

export async function lendingPythExample() {
  const tx = new Transaction()
  const hermes = new SuiPriceServiceConnection('https://hermes.pyth.network')
  const pyth = new SuiPythClient(
    client,
    '0x0000000000000000000000000000000000000000000000000000000000000002',
    '0x0000000000000000000000000000000000000000000000000000000000000003'
  )

  const updates = await hermes.getPriceFeedsUpdateData(['0xe62df6c8b4a85fe1a67a56e9a2a15'])
  await pyth.updatePriceFeeds(tx, updates, ['0xe62df6c8b4a85fe1a67a56e9a2a15'])

  return tx
}

export function walletClientExample() {
  return new WalletClient({
    signer: new WatchSigner(userAddress),
    client: {
      url: getJsonRpcFullnodeUrl('mainnet')
    }
  })
}

export async function aggregatorExample(quote: Quote) {
  await getSwapQuote(suiCoinType, navxCoinType, '1000000000')

  const tx = new Transaction()
  const inputCoin = tx.splitCoins(tx.gas, [tx.pure.u64(quote.amount_in)])
  tx.transferObjects([inputCoin], userAddress)

  return dryRunSwapTransaction(tx, {
    client: customClient
  })
}

const bridgeSuiToken: Token = {
  address: suiCoinType,
  chainId: 1999,
  decimals: 9,
  logoURI: '',
  name: 'Sui',
  chainName: 'Sui',
  symbol: 'SUI',
  isSuggest: true,
  isVerify: true,
  category: []
}

const bridgeUsdcToken: Token = {
  address: 'sol-usdc',
  chainId: 1,
  decimals: 6,
  logoURI: '',
  name: 'USD Coin',
  chainName: 'Solana',
  symbol: 'USDC',
  isSuggest: true,
  isVerify: true,
  category: []
}

export async function bridgeExample(quote: BridgeSwapQuote) {
  await getBridgeQuote(bridgeSuiToken, bridgeUsdcToken, '1000000000', {
    slippageBps: 50
  })

  const transaction = await bridgeSwap(quote, userAddress, 'sol-recipient', {
    sui: {
      provider: customClient,
      signTransaction: async () => ({
        bytes: 'signed-transaction-bytes',
        signature: 'signed-transaction-signature'
      })
    }
  })

  return getBridgeTransaction(transaction.bridgeSourceTxHash)
}

export async function dcaExample() {
  const createTx = await createDcaOrder(customClient, userAddress, {
    fromCoinType: suiCoinType,
    toCoinType: navxCoinType,
    depositedAmount: '1000000000',
    totalExecutions: 10,
    frequency: {
      value: 1,
      unit: TimeUnit.HOUR
    },
    priceRange: {
      minBuyPrice: 40000000,
      maxBuyPrice: 50000000
    }
  })

  await dryRunDcaTransaction(createTx, {
    client: customClient
  })

  const cancelTx = await cancelDcaOrder(
    {
      fromCoinType: suiCoinType,
      toCoinType: navxCoinType
    },
    '0x0000000000000000000000000000000000000000000000000000000000000004',
    userAddress
  )

  return dryRunDcaTransaction(cancelTx, {
    client: customClient
  })
}
