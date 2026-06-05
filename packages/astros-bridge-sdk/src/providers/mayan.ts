import {
  createSwapFromSuiMoveCalls,
  Quote as MayanQuote,
  swapFromSolana,
  swapFromEvm,
  SolanaTransactionSigner,
  JitoBundleOptions,
  Erc20Permit,
  addresses
} from '@mayanfinance/swap-sdk'
import {
  SuiClient as LegacySuiClient,
  getFullnodeUrl as getLegacyFullnodeUrl
} from '@mysten/sui-v1/client'
import { BridgeSwapQuote, WalletConnection } from '../types'
import { Transaction } from '@mysten/sui/transactions'
import { Connection, SendOptions } from '@solana/web3.js'
import { Signer, Overrides, Contract, parseUnits } from 'ethers'

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)'
]

enum BridgeChain {
  SUI = 1999,
  SOLANA = 0
}

const DEFAULT_SUI_BRIDGE_GAS_BUDGET = 100_000_000

type SuiExecutionResponse = {
  digest?: string
  effects?: null | {
    status?: {
      status?: string
      error?: string
    }
  }
}

function getRequiredAllowance(mayanQuote: MayanQuote, decimals: number) {
  const amountInBaseUnits = (mayanQuote as MayanQuote & { effectiveAmountIn64?: string | number })
    .effectiveAmountIn64
  if (amountInBaseUnits !== undefined && amountInBaseUnits !== null) {
    return BigInt(amountInBaseUnits)
  }

  return parseUnits(String(mayanQuote.effectiveAmountIn), decimals)
}

function assertSuiExecutionSuccess(resp: SuiExecutionResponse) {
  if (!resp.digest) {
    throw new Error('Sui bridge source transaction did not return a digest')
  }

  const status = resp.effects?.status
  if (status?.status && status.status !== 'success') {
    throw new Error(`Sui bridge source transaction failed: ${status.error ?? status.status}`)
  }
}

function getLegacySuiRpcUrl(walletConnection: NonNullable<WalletConnection['sui']>) {
  if (walletConnection.rpcUrl) {
    return walletConnection.rpcUrl
  }

  const network = walletConnection.provider.network
  switch (network) {
    case 'mainnet':
      return getLegacyFullnodeUrl('mainnet')
    case 'testnet':
      return getLegacyFullnodeUrl('testnet')
    case 'devnet':
      return getLegacyFullnodeUrl('devnet')
    default:
      throw new Error(
        `Unsupported Sui network "${String(network)}"; provide walletConnection.sui.rpcUrl for custom networks`
      )
  }
}

/**
 * Executes a cross-chain token swap
 * @param route - The swap quote to execute
 * @param fromAddress - Source wallet address
 * @param toAddress - Destination wallet address
 * @param walletConnection - Wallet connection for signing
 * @param referrerAddresses - Optional referrer addresses for different chains (sui, evm, solana)
 * @returns Promise<string> - Transaction digest
 */
export async function swap(
  route: BridgeSwapQuote,
  fromAddress: string,
  toAddress: string,
  walletConnection: WalletConnection,
  referrerAddresses?: {
    sui?: string
    evm?: string
    solana?: string
  }
): Promise<string> {
  if (!route) {
    throw new Error('No route found')
  }
  const mayanQuote = route.info_for_bridge as MayanQuote
  let hash: string
  if (route.from_token.chainId === BridgeChain.SUI) {
    if (!walletConnection.sui) {
      throw new Error('Sui wallet connection not found')
    }
    const connection = walletConnection.sui
    const client = connection.provider
    const legacyClient = new LegacySuiClient({
      url: getLegacySuiRpcUrl(connection)
    })
    const legacySwapTrx = await createSwapFromSuiMoveCalls(
      mayanQuote,
      fromAddress,
      toAddress,
      referrerAddresses,
      null,
      legacyClient as any
    )
    legacySwapTrx.setSenderIfNotSet(fromAddress)
    legacySwapTrx.setGasBudget(connection.gasBudget ?? DEFAULT_SUI_BRIDGE_GAS_BUDGET)
    const legacyBytes = await legacySwapTrx.build({ client: legacyClient as any })
    const swapTrx = Transaction.from(legacyBytes)
    const signed: {
      bytes: string
      signature: string
    } = await connection.signTransaction({ transaction: swapTrx })
    const resp = await client.executeTransactionBlock({
      transactionBlock: signed.bytes,
      signature: [signed.signature],
      options: {
        showEffects: true,
        showEvents: true,
        showBalanceChanges: true
      }
    })
    assertSuiExecutionSuccess(resp)
    hash = resp.digest
    await client.waitForTransaction({
      digest: hash
    })
  } else if (route.from_token.chainId === BridgeChain.SOLANA) {
    if (!walletConnection.solana) {
      throw new Error('Solana wallet connection not found')
    }
    const connection = walletConnection.solana
    const swapTrx = await swapFromSolana(
      mayanQuote,
      fromAddress,
      toAddress,
      referrerAddresses,
      connection.signTransaction as SolanaTransactionSigner,
      connection.connection as Connection,
      connection.extraRpcs,
      connection.sendOptions as SendOptions | undefined,
      connection.jitoOptions as JitoBundleOptions | undefined
    )
    hash = swapTrx.signature
  } else {
    if (!walletConnection.evm) {
      throw new Error('EVM wallet connection not found')
    }
    const connection = walletConnection.evm
    const fromToken = mayanQuote.fromToken
    if (fromToken.standard === 'erc20') {
      const erc20Contract = new Contract(
        fromToken.realOriginContractAddress || fromToken.contract,
        ERC20_ABI,
        connection.signer as Signer
      )
      const currentAllowance = await erc20Contract.allowance(
        fromAddress,
        addresses.MAYAN_FORWARDER_CONTRACT
      )
      const REQUIRED_ALLOWANCE = getRequiredAllowance(mayanQuote, fromToken.decimals)
      if (currentAllowance < REQUIRED_ALLOWANCE) {
        const approveTrx = await erc20Contract.approve(
          addresses.MAYAN_FORWARDER_CONTRACT,
          REQUIRED_ALLOWANCE
        )
        const receiptApprove = await approveTrx.wait()
        if (!receiptApprove) {
          throw new Error('Failed to approve allowance')
        }
      }
    }
    const swapTrx = await swapFromEvm(
      mayanQuote,
      fromAddress,
      toAddress,
      referrerAddresses,
      connection.signer as any,
      connection.permit as Erc20Permit | null | undefined,
      connection.overrides as Overrides | null | undefined,
      null
    )
    hash = typeof swapTrx === 'string' ? swapTrx : swapTrx.hash
    if (typeof swapTrx !== 'string' || !mayanQuote.gasless) {
      await connection.waitForTransaction({
        hash,
        confirmations: 3
      })
    }
  }
  // wait for 2 seconds to make sure the mayan has processed the transaction
  await new Promise((resolve) => {
    setTimeout(() => {
      resolve(true)
    }, 2000)
  })
  return hash
}
