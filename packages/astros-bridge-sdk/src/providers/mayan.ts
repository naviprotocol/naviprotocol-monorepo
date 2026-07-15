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
import { BridgeSwapQuote, WalletConnection } from '../types'
import { Connection, SendOptions } from '@solana/web3.js'
import { Signer, Overrides, Contract, parseUnits } from 'ethers'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)'
]

enum BridgeChain {
  SUI = 1999,
  SOLANA = 0
}

type SuiExecutionResponse = {
  $kind?: 'Transaction' | 'FailedTransaction'
  digest?: string
  Transaction?: {
    digest: string
    effects?: null | {
      status?: {
        success?: boolean
        status?: string
        error?: unknown
      }
    }
    status?: {
      success: boolean
      error?: unknown
    }
  }
  FailedTransaction?: {
    digest: string
    effects?: null | {
      status?: {
        success?: boolean
        status?: string
        error?: unknown
      }
    }
    status?: {
      success: boolean
      error?: unknown
    }
  }
  status?: {
    success?: boolean
    status?: string
    error?: unknown
  }
}

type SuiBridgeExecutionClient = {
  executeTransaction(options: any): Promise<SuiExecutionResponse>
  waitForTransaction(options: any): Promise<SuiExecutionResponse | undefined>
}

function getRequiredAllowance(mayanQuote: MayanQuote, decimals: number) {
  const amountInBaseUnits = (mayanQuote as MayanQuote & { effectiveAmountIn64?: string | number })
    .effectiveAmountIn64
  if (amountInBaseUnits !== undefined && amountInBaseUnits !== null) {
    return BigInt(amountInBaseUnits)
  }

  return parseUnits(String(mayanQuote.effectiveAmountIn), decimals)
}

function getSuiExecutionTransaction(resp: SuiExecutionResponse) {
  return resp.Transaction ?? resp.FailedTransaction ?? (resp.digest ? resp : undefined)
}

function assertSuiExecutionSuccess(resp: SuiExecutionResponse) {
  const transaction = getSuiExecutionTransaction(resp)
  if (!transaction?.digest) {
    throw new Error('Sui bridge source transaction did not return a digest')
  }

  const statusSource = transaction as {
    status?: {
      success?: boolean
      status?: string
      error?: unknown
    }
    effects?: null | {
      status?: {
        success?: boolean
        status?: string
        error?: unknown
      }
    }
  }
  const status = statusSource.status ?? statusSource.effects?.status
  const failed =
    resp.$kind === 'FailedTransaction' || status?.success === false || status?.status === 'failure'
  if (failed) {
    throw new Error(
      `Sui bridge source transaction failed: ${String(status?.error ?? 'unknown status')}`
    )
  }
}

function getSuiExecutionDigest(resp: SuiExecutionResponse) {
  const digest = getSuiExecutionTransaction(resp)?.digest
  if (!digest) {
    throw new Error('Sui bridge source transaction did not return a digest')
  }
  return digest
}

function assertSuiWaitResult(
  resp: SuiExecutionResponse | undefined
): asserts resp is SuiExecutionResponse {
  if (!resp) {
    throw new Error('Sui bridge source transaction wait did not return final transaction effects')
  }
}

function assertSuiBuildClient(
  client: unknown,
  label = 'Sui bridge build client'
): asserts client is {
  core: {
    getMoveFunction(options: any): Promise<any>
    getObjects(options: any): Promise<any>
    getBalance(options: any): Promise<any>
    listCoins(options: any): Promise<any>
    getObject(options: any): Promise<any>
    getCurrentSystemState(options?: any): Promise<any>
    getChainIdentifier(options?: any): Promise<any>
    simulateTransaction(options: any): Promise<any>
  }
} {
  const provider = client as {
    core?: Record<string, unknown>
  }
  const missing: string[] = []

  if (!provider?.core || typeof provider.core !== 'object') {
    missing.push('core')
  } else {
    for (const method of [
      'getMoveFunction',
      'getObjects',
      'getBalance',
      'listCoins',
      'getObject',
      'getCurrentSystemState',
      'getChainIdentifier',
      'simulateTransaction'
    ] as const) {
      if (typeof provider.core[method] !== 'function') {
        missing.push(`core.${method}`)
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `${label} must implement the Sui SDK v2 Core API required by Transaction.build: missing ${missing.join(', ')}`
    )
  }
}

function assertSuiBridgeProvider(client: unknown): asserts client is {
  core: {
    getMoveFunction(options: any): Promise<any>
    getObjects(options: any): Promise<any>
    getBalance(options: any): Promise<any>
    listCoins(options: any): Promise<any>
    getObject(options: any): Promise<any>
    getCurrentSystemState(options?: any): Promise<any>
    getChainIdentifier(options?: any): Promise<any>
    simulateTransaction(options: any): Promise<any>
    executeTransaction?(options: any): Promise<any>
    waitForTransaction?(options: any): Promise<any>
  }
  executeTransaction?(options: any): Promise<any>
  waitForTransaction?(options: any): Promise<any>
} {
  assertSuiBuildClient(client, 'Sui bridge provider')
  getSuiBridgeExecutionClient(client)
}

function getSuiBridgeExecutionClient(client: unknown): SuiBridgeExecutionClient {
  const provider = client as {
    executeTransaction?: unknown
    waitForTransaction?: unknown
    core?: {
      executeTransaction?: unknown
      waitForTransaction?: unknown
    }
  }

  const executeTransaction =
    typeof provider?.executeTransaction === 'function'
      ? provider.executeTransaction.bind(provider)
      : typeof provider?.core?.executeTransaction === 'function'
        ? provider.core.executeTransaction.bind(provider.core)
        : undefined
  const waitForTransaction =
    typeof provider?.waitForTransaction === 'function'
      ? provider.waitForTransaction.bind(provider)
      : typeof provider?.core?.waitForTransaction === 'function'
        ? provider.core.waitForTransaction.bind(provider.core)
        : undefined

  const missing: string[] = []
  if (!executeTransaction) {
    missing.push('executeTransaction')
  }
  if (!waitForTransaction) {
    missing.push('waitForTransaction')
  }

  if (missing.length > 0) {
    throw new Error(
      `Sui bridge provider must implement Sui SDK v2 Core API and execution methods: missing ${missing.join(', ')}`
    )
  }

  return {
    executeTransaction,
    waitForTransaction
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
    assertSuiBridgeProvider(client)
    const executionClient = getSuiBridgeExecutionClient(client)
    const buildClient = connection.buildClient ?? client
    assertSuiBuildClient(buildClient)
    const swapTrx = await createSwapFromSuiMoveCalls(
      mayanQuote,
      fromAddress,
      toAddress,
      referrerAddresses,
      null,
      buildClient as any
    )
    swapTrx.setSenderIfNotSet(fromAddress)
    if (connection.gasBudget !== undefined) {
      swapTrx.setGasBudget(connection.gasBudget)
    }
    const transaction =
      buildClient === client
        ? swapTrx
        : Transaction.from(await swapTrx.build({ client: buildClient as any }))
    const signed: {
      bytes: string
      signature: string
    } = await connection.signTransaction({ transaction })
    const resp = await executionClient.executeTransaction({
      transaction: fromBase64(signed.bytes),
      signatures: [signed.signature],
      include: {
        effects: true,
        events: true,
        balanceChanges: true
      }
    })
    assertSuiExecutionSuccess(resp)
    hash = getSuiExecutionDigest(resp)
    const waitResult = await executionClient.waitForTransaction({
      digest: hash,
      include: {
        effects: true
      }
    })
    assertSuiWaitResult(waitResult)
    assertSuiExecutionSuccess(waitResult)
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
    if (!mayanQuote.gasless) {
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
