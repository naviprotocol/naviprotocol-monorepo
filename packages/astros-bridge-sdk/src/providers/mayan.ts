import {
  createSwapFromSuiMoveCalls,
  getSwapSui,
  addInitOrderMoveCalls,
  addBridgeLockedFeeMoveCalls,
  addBridgeWithFeeMoveCalls,
  addFastMctpBridgeMoveCalls,
  addFastMctpCreateOrderMoveCalls,
  fetchMayanSuiPackageId,
  getQuoteSuitableReferrerAddress,
  nativeAddressToHexString,
  getWormholeChainIdByName,
  resolveInputCoin,
  ComposableSuiMoveCallsOptions,
  Quote as MayanQuote,
  swapFromSolana,
  swapFromEvm,
  SolanaTransactionSigner,
  JitoBundleOptions,
  Erc20Permit,
  addresses
} from '@mayanfinance/swap-sdk'
import { BridgeSwapQuote, NaviBridgeSuiBuildClient, WalletConnection } from '../types'
import { Connection, SendOptions, SystemProgram } from '@solana/web3.js'
import { Signer, Overrides, Contract, parseUnits, ZeroAddress } from 'ethers'
import { Transaction } from '@mysten/sui/transactions'
import {
  fromBase64,
  normalizeStructTag,
  normalizeSuiAddress,
  SUI_TYPE_ARG
} from '@mysten/sui/utils'

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

// The token a Sui-source Mayan order bridges through: USDC for MCTP and Fast MCTP alike.
function getSuiMiddleContract(quote: MayanQuote) {
  if (quote.type === 'MCTP') return quote.mctpInputContract
  if (quote.type === 'FAST_MCTP') return quote.fastMctpInputContract
  return undefined
}

/**
 * When the Sui source token is not the MCTP / Fast MCTP input token (USDC), Mayan's server builds the
 * pre-swap into USDC and picks the input coins itself. That server-side selection only sees
 * `Coin` objects, so a wallet holding the token only as Sui address balance gets `NO_COINS`.
 * Preparing the input coin locally keeps coin selection on our side: SUI is split from the
 * gas coin, which is funded from coin objects or address balance alike; other tokens go
 * through Mayan's own selection, which backfills from the address balance.
 */
async function prepareSuiSwapInput(
  mayanQuote: MayanQuote,
  owner: string,
  client: Parameters<typeof resolveInputCoin>[3]
): Promise<ComposableSuiMoveCallsOptions | undefined> {
  const { fromToken, effectiveAmountIn64 } = mayanQuote
  const middleContract = getSuiMiddleContract(mayanQuote)
  if (!fromToken?.contract || !middleContract || !effectiveAmountIn64) {
    return undefined
  }
  const inputType = normalizeStructTag(fromToken.contract)
  if (inputType === normalizeStructTag(middleContract)) {
    return undefined
  }
  const amount = BigInt(effectiveAmountIn64)
  const tx = new Transaction()
  const inputCoin =
    inputType === normalizeStructTag(SUI_TYPE_ARG)
      ? tx.splitCoins(tx.gas, [amount])[0]
      : await resolveInputCoin(amount, owner, fromToken.contract, client, tx)
  return {
    builtTransaction: tx,
    inputCoin: { result: inputCoin } as ComposableSuiMoveCallsOptions['inputCoin']
  }
}

/**
 * Builds a Sui-source MCTP bridge whose pre-swap is requested without the referrer.
 *
 * With a referrer attached, Mayan's server routes the pre-swap through a different router
 * than the one its quote was priced on, while the order still enforces the quote's
 * `minMiddleAmount`. That route can land short of it, or fail outright, and the bridge
 * aborts. The pre-swap request is the only place this changes: an auction order still
 * records the referrer and `referrerBps` in `init_order`, and the non-auction bridge calls,
 * which never carry a referrer, are made exactly as Mayan's `createMctpFromSuiMoveCalls`
 * makes them. Every quote minimum is unchanged.
 */
async function createSuiMctpWithUnreferredPreSwap(
  quote: MayanQuote,
  swapperAddress: string,
  destinationAddress: string,
  referrerAddress: string,
  client: Parameters<typeof fetchMayanSuiPackageId>[1],
  prepared: ComposableSuiMoveCallsOptions
) {
  if (!quote.fromToken.verifiedAddress) {
    throw new Error('from token verified address is not provided')
  }
  const [mctpPackageId, feeManagerPackageId] = await Promise.all([
    fetchMayanSuiPackageId(addresses.SUI_MCTP_STATE, client),
    quote.hasAuction ? fetchMayanSuiPackageId(addresses.SUI_MCTP_FEE_MANAGER_STATE, client) : null
  ])
  const swap = await getSwapSui({
    amountIn64: quote.effectiveAmountIn64,
    inputCoinType: quote.fromToken.contract,
    middleCoinType: quote.mctpInputContract,
    userWallet: swapperAddress,
    withWhFee: quote.hasAuction || quote.cheaperChain !== 'sui',
    inputCoin: prepared.inputCoin,
    transaction: prepared.builtTransaction ? await prepared.builtTransaction.toJSON() : undefined,
    slippageBps: quote.slippageBps,
    chainName: quote.fromChain
  })
  const tx = Transaction.from(swap.tx)
  const preSwapCommandCount = tx.getData().commands.length
  const options = {
    inputCoin: { result: swap.outCoin },
    whFeeCoin: swap.whFeeCoin ? { result: swap.whFeeCoin } : null,
    builtTransaction: tx
  } as ComposableSuiMoveCallsOptions
  if (quote.hasAuction) {
    if (!feeManagerPackageId) {
      throw new Error('Fee manager package ID is not found for swap quote')
    }
    await addInitOrderMoveCalls(
      quote,
      swapperAddress,
      destinationAddress,
      referrerAddress,
      mctpPackageId,
      feeManagerPackageId,
      client,
      options
    )
  } else if (quote.cheaperChain === 'sui') {
    await addBridgeLockedFeeMoveCalls(
      quote,
      swapperAddress,
      destinationAddress,
      mctpPackageId,
      client,
      options
    )
  } else {
    await addBridgeWithFeeMoveCalls(
      quote,
      swapperAddress,
      destinationAddress,
      mctpPackageId,
      null,
      client,
      options
    )
  }
  tx.moveCall({
    package: mctpPackageId,
    module: 'init_order',
    function: 'log_initialize_mctp',
    typeArguments: [quote.fromToken.contract],
    arguments: [
      tx.pure.u64(BigInt(quote.effectiveAmountIn64)),
      tx.object(quote.fromToken.verifiedAddress),
      tx.pure.vector('u8', [])
    ]
  })
  tx.moveCall({
    package: addresses.SUI_LOGGER_PACKAGE_ID,
    module: 'referrer_logger',
    function: 'log_referrer',
    arguments: [
      tx.pure.address(
        nativeAddressToHexString(referrerAddress, getWormholeChainIdByName(quote.toChain))
      ),
      tx.pure.u8(quote.referrerBps || 0)
    ]
  })
  return {
    tx,
    preSwapCommandCount,
    isMinMiddleMiss: (message: string) =>
      isMoveAbort(message, mctpPackageId, ['init_order::prepare_initialize_order'], 4)
  }
}

/**
 * The Fast MCTP (Circle CCTP v2) counterpart of `createSuiMctpWithUnreferredPreSwap`. It makes
 * the calls Mayan's `createFastMctpFromSuiMoveCalls` makes, except that the pre-swap is requested
 * without the referrer. Fast MCTP carries the referrer and `referrerBps` on the order whether or
 * not it is an auction, so both order calls still receive the referrer.
 */
async function createSuiFastMctpWithUnreferredPreSwap(
  quote: MayanQuote,
  swapperAddress: string,
  destinationAddress: string,
  referrerAddress: string,
  client: Parameters<typeof fetchMayanSuiPackageId>[1],
  prepared: ComposableSuiMoveCallsOptions
) {
  const currencyId = quote.fromToken.currencyId
  if (!currencyId || !quote.fastMctpInputCurrencyId) {
    throw new Error('from token or fast mctp input currency id is not provided')
  }
  if (
    !destinationAddress ||
    destinationAddress === ZeroAddress ||
    destinationAddress === SystemProgram.programId.toString()
  ) {
    throw new Error('Invalid destination address for fast mctp')
  }
  const fastMctpPackageId = await fetchMayanSuiPackageId(addresses.SUI_FAST_MCTP_STATE, client)
  const swap = await getSwapSui({
    amountIn64: quote.effectiveAmountIn64,
    inputCoinType: quote.fromToken.contract,
    middleCoinType: quote.fastMctpInputContract,
    userWallet: swapperAddress,
    withWhFee: false,
    inputCoin: prepared.inputCoin,
    transaction: prepared.builtTransaction ? await prepared.builtTransaction.toJSON() : undefined,
    slippageBps: quote.slippageBps,
    chainName: quote.fromChain
  })
  const tx = Transaction.from(swap.tx)
  const preSwapCommandCount = tx.getData().commands.length
  const options = {
    inputCoin: { result: swap.outCoin },
    builtTransaction: tx
  } as ComposableSuiMoveCallsOptions
  if (quote.hasAuction) {
    await addFastMctpCreateOrderMoveCalls(
      quote,
      swapperAddress,
      destinationAddress,
      referrerAddress,
      fastMctpPackageId,
      client,
      options
    )
  } else {
    await addFastMctpBridgeMoveCalls(
      quote,
      swapperAddress,
      destinationAddress,
      referrerAddress,
      fastMctpPackageId,
      null,
      client,
      options
    )
  }
  tx.moveCall({
    package: fastMctpPackageId,
    module: 'bridge',
    function: 'log_initialize_fast_mctp',
    typeArguments: [quote.fromToken.contract],
    arguments: [
      tx.pure.u64(BigInt(quote.effectiveAmountIn64)),
      tx.object(currencyId),
      tx.pure.vector('u8', [])
    ]
  })
  return {
    tx,
    preSwapCommandCount,
    isMinMiddleMiss: (message: string) =>
      isMoveAbort(
        message,
        fastMctpPackageId,
        ['bridge::prepare_bridge', 'create_order::prepare_create_order'],
        1
      )
  }
}

const SUI_PRESWAP_MAX_BUILDS = 3

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  const message = (error as { message?: unknown } | null)?.message
  if (typeof message === 'string') return message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

// Mayan's own order check: the pre-swap output landed below the quote's minimum middle amount.
// MCTP aborts with code 4 in `init_order::prepare_initialize_order`; Fast MCTP with code 1 in
// `bridge::prepare_bridge` or `create_order::prepare_create_order`.
function isMoveAbort(message: string, packageId: string, functions: string[], code: number) {
  const location = message.match(/abort code: (\d+), in '(0x[0-9a-f]+)::(\w+::\w+)'/)
  return (
    !!location &&
    Number(location[1]) === code &&
    functions.includes(location[3]) &&
    normalizeSuiAddress(location[2]) === normalizeSuiAddress(packageId)
  )
}

// Mayan's server intermittently returns a pre-swap with an unset argument; only a failure
// inside the commands it returned is attributed to that.
function isMalformedPreSwap(message: string, preSwapCommandCount: number) {
  const command = message.match(/ArgumentWithoutValue.*?in command (\d+)/)
  return !!command && Number(command[1]) < preSwapCommandCount
}

function quoteExpiredError(reason: string, cause?: unknown) {
  return Object.assign(
    new Error(`Bridge quote is no longer executable: ${reason}. Fetch a new quote.`),
    { code: 'BRIDGE_QUOTE_EXPIRED', cause }
  )
}

function assertQuoteNotExpired(quote: MayanQuote) {
  const deadline = Number(quote.deadline64)
  if (Number.isFinite(deadline) && deadline > 0 && Date.now() / 1000 >= deadline) {
    throw quoteExpiredError('the quote deadline has passed')
  }
}

function getSimulationFailure(result: SuiExecutionResponse): string | undefined {
  const transaction = getSuiExecutionTransaction(result) as
    | { status?: { success?: boolean; error?: unknown }; effects?: null | { status?: any } }
    | undefined
  const status = transaction?.status ?? transaction?.effects?.status ?? result.status
  if (status?.success === true || status?.status === 'success') return undefined
  return getErrorMessage(status?.error ?? status ?? 'Sui bridge transaction simulation failed')
}

/**
 * Builds the unreferred pre-swap bridge and simulates it before it reaches the wallet.
 * Only a pre-swap that misses the order minimum, or comes back malformed from Mayan's server,
 * is rebuilt from the same quote, for at most three builds and never past the quote deadline.
 * The quote's minimums are never relaxed. Request and RPC timeouts stay with the caller's
 * clients; this bounds the number of builds, not wall-clock time.
 */
async function buildSimulatedUnreferredPreSwap(
  quote: MayanQuote,
  swapperAddress: string,
  destinationAddress: string,
  referrerAddress: string,
  buildClient: NaviBridgeSuiBuildClient,
  provider: NaviBridgeSuiBuildClient,
  gasBudget: number | undefined,
  firstInput: ComposableSuiMoveCallsOptions
): Promise<Transaction> {
  let lastFailure: unknown
  let lastWasMinMiddleMiss = false
  for (let attempt = 1; attempt <= SUI_PRESWAP_MAX_BUILDS; attempt++) {
    assertQuoteNotExpired(quote)
    const prepared =
      attempt === 1
        ? firstInput
        : await prepareSuiSwapInput(quote, swapperAddress, buildClient as any)
    const buildUnreferredPreSwap =
      quote.type === 'FAST_MCTP'
        ? createSuiFastMctpWithUnreferredPreSwap
        : createSuiMctpWithUnreferredPreSwap
    const { tx, preSwapCommandCount, isMinMiddleMiss } = await buildUnreferredPreSwap(
      quote,
      swapperAddress,
      destinationAddress,
      referrerAddress,
      buildClient as any,
      prepared!
    )
    tx.setSenderIfNotSet(swapperAddress)
    if (gasBudget !== undefined) {
      tx.setGasBudget(gasBudget)
    }
    let failure: unknown
    try {
      const message = getSimulationFailure(
        await provider.core.simulateTransaction({
          transaction: await tx.build({ client: buildClient as any }),
          include: { effects: true }
        })
      )
      if (!message) {
        assertQuoteNotExpired(quote)
        return tx
      }
      failure = new Error(message)
    } catch (error) {
      failure = error
    }
    const message = getErrorMessage(failure)
    lastWasMinMiddleMiss = isMinMiddleMiss(message)
    if (!lastWasMinMiddleMiss && !isMalformedPreSwap(message, preSwapCommandCount)) {
      throw failure
    }
    lastFailure = failure
  }
  if (lastWasMinMiddleMiss) {
    throw quoteExpiredError('the Sui pre-swap output is below the quote minimum', lastFailure)
  }
  throw lastFailure
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
    const prepared = await prepareSuiSwapInput(mayanQuote, fromAddress, buildClient as any)
    const preSwapReferrer =
      connection.preswapRouting === 'mayan' && prepared
        ? getQuoteSuitableReferrerAddress(mayanQuote, referrerAddresses)
        : null
    let swapTrx: Transaction
    if (preSwapReferrer) {
      swapTrx = await buildSimulatedUnreferredPreSwap(
        mayanQuote,
        fromAddress,
        toAddress,
        preSwapReferrer,
        buildClient,
        client,
        connection.gasBudget,
        prepared!
      )
    } else {
      swapTrx = await createSwapFromSuiMoveCalls(
        mayanQuote,
        fromAddress,
        toAddress,
        referrerAddresses,
        null,
        buildClient as any,
        prepared
      )
      swapTrx.setSenderIfNotSet(fromAddress)
      if (connection.gasBudget !== undefined) {
        swapTrx.setGasBudget(connection.gasBudget)
      }
    }
    const transaction =
      buildClient === client
        ? swapTrx
        : Transaction.from(await swapTrx.build({ client: buildClient as any }))
    if (preSwapReferrer) {
      assertQuoteNotExpired(mayanQuote)
    }
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
