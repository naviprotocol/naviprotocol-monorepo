/**
 * Wallet Client - Core Client Implementation
 *
 * This module provides the main wallet client for interacting with the Sui blockchain.
 * It manages transaction signing, module integration, and provides a unified interface
 * for various DeFi operations including swaps, lending, and balance management.
 *
 * @module WalletClient
 */

import { Signer } from '@mysten/sui/cryptography'
import mitt, { Emitter } from 'mitt'
import { Module, ModuleConfig } from './modules/module'
import { modules, ModuleName, ModuleEvents } from './modules'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import {
  DryRunOptions,
  NaviTransactionExecutionOptions,
  NaviWalletTransactionResult
} from './types'
import { mergeTransactionResponseOptions, normalizeTransactionResult } from './transaction-result'
import {
  createNaviLegacyJsonRpcClient,
  createNaviSuiClientBundle,
  type NaviCoreClient,
  type NaviJsonRpcCompatClient,
  type NaviSdkServiceOptions,
  type NaviSuiClientBundle,
  type NaviSuiClientOptions,
  type NaviSuiLegacyJsonRpcOptions,
  type NaviSuiNetwork
} from '@naviprotocol/lending'

/**
 * Extracts the configuration type from a module
 */
type ExtractModuleConfig<T> = T extends Module<infer TConfig, any> ? TConfig : never

/**
 * User configuration type for all modules
 */
export type UserConfigs = {
  [K in ModuleName]: Partial<ExtractModuleConfig<(typeof modules)[K]>>
}

/**
 * Options for initializing the wallet client
 */
export type WalletClientOptions = {
  /** The signer for transaction signing */
  signer: Signer
  /** Optional module-specific configurations */
  configs?: Partial<UserConfigs>
  /** Sui v2 client configuration. Release paths must provide `network + grpc`. */
  client: NaviSuiClientOptions | WalletLegacyJsonRpcClientOptions
}

export type WalletLegacyJsonRpcClientOptions = {
  network?: NaviSuiNetwork
  /**
   * @deprecated JSON-RPC is a short-lived compatibility transport. New paths must use `grpc`.
   */
  legacyJsonRpc: NaviSuiLegacyJsonRpcOptions
  services?: NaviSdkServiceOptions
}

function transactionIncludeOptions(options?: NaviTransactionExecutionOptions['options']) {
  const merged = mergeTransactionResponseOptions(options)
  return {
    effects: merged.showEffects,
    events: merged.showEvents,
    balanceChanges: merged.showBalanceChanges,
    objectTypes: merged.showObjectChanges
  }
}

function getCoreTransactionClient(client: unknown) {
  return (client as { core?: unknown }).core as
    | {
        simulateTransaction?(options: any): Promise<any>
        executeTransaction?(options: any): Promise<any>
      }
    | undefined
}

function isNaviSuiClientOptions(
  options: NaviSuiClientOptions | WalletLegacyJsonRpcClientOptions
): options is NaviSuiClientOptions {
  return 'grpc' in options
}

function createWalletClientBundle(
  options: NaviSuiClientOptions | WalletLegacyJsonRpcClientOptions
): NaviSuiClientBundle {
  if (isNaviSuiClientOptions(options)) {
    return createNaviSuiClientBundle(options)
  }
  const network = options.network ?? 'mainnet'
  const legacyJsonRpc = createNaviLegacyJsonRpcClient(network, options.legacyJsonRpc)
  return {
    network,
    coreClient: legacyJsonRpc,
    grpc: legacyJsonRpc,
    legacyJsonRpc,
    services: options.services
  }
}

/**
 * Main wallet client class that provides unified access to blockchain operations
 *
 * This class integrates various modules (swap, lending, balance, etc.) and provides
 * a consistent interface for interacting with the Sui blockchain. It handles
 * transaction signing, module management, and event emission.
 */
export class WalletClient {
  /** The signer instance for transaction signing */
  public readonly signer: Signer

  /** Available modules for different functionalities */
  private readonly modules = modules

  /** User-provided module configurations */
  private readonly userConfigs: Partial<UserConfigs> = {}

  /** Event emitter for module events */
  public readonly events: Emitter<ModuleEvents> = mitt()

  /** The Sui client instance */
  public readonly client: NaviCoreClient & Partial<NaviJsonRpcCompatClient>

  /** Normalized transport bundle for modules that need transport-specific clients. */
  public readonly clientBundle: NaviSuiClientBundle

  /** URL used by the default JSON-RPC client, when available. */
  public readonly clientUrl?: string

  public get lending() {
    return this.modules.lending
  }

  public get balance() {
    return this.modules.balance
  }

  public get volo() {
    return this.modules.volo
  }

  public get swap() {
    return this.modules.swap
  }

  public get haedal() {
    return this.modules.haedal
  }

  /**
   * Creates a new wallet client instance
   * @param options - Configuration options for the wallet client
   */
  constructor(options: WalletClientOptions) {
    this.clientBundle = createWalletClientBundle(options.client)
    this.client = this.clientBundle.coreClient as NaviCoreClient & Partial<NaviJsonRpcCompatClient>
    this.clientUrl =
      'grpc' in options.client
        ? options.client.legacyJsonRpc && 'url' in options.client.legacyJsonRpc
          ? options.client.legacyJsonRpc.url
          : undefined
        : 'url' in options.client.legacyJsonRpc
          ? options.client.legacyJsonRpc.url
          : undefined
    this.signer = options.signer
    this.userConfigs = options.configs || {}

    // Install all modules and validate their names
    Object.entries(this.modules).forEach(([name, module]) => {
      if (name !== module.name) {
        throw new Error(`Module name ${name} does not match module name ${module.name}`)
      }
      module.install(this)
    })
  }

  /**
   * Signs and executes a transaction block
   * @param options - Transaction execution options including dry run support
   * @returns Promise with transaction execution result
   */
  async signExecuteTransaction(
    options: {
      transaction: Uint8Array | Transaction
    } & NaviTransactionExecutionOptions &
      Partial<DryRunOptions>
  ): Promise<NaviWalletTransactionResult<boolean>> {
    const { dryRun = false, ...rest } = options

    if (dryRun) {
      const core = getCoreTransactionClient(this.client)
      if (typeof core?.simulateTransaction === 'function') {
        if (options.transaction instanceof Transaction) {
          options.transaction.setSenderIfNotSet(this.address)
        }
        const result = await core.simulateTransaction({
          transaction: options.transaction,
          include: transactionIncludeOptions(rest.options)
        })
        return normalizeTransactionResult('dryRun', result)
      }

      const legacyJsonRpc = this.clientBundle.legacyJsonRpc
      if (!legacyJsonRpc) {
        throw new Error(
          'WalletClient dry-run requires core.simulateTransaction or an explicit legacyJsonRpc client'
        )
      }
      // Handle dry run mode for transaction simulation
      let txBytes
      if (options.transaction instanceof Transaction) {
        options.transaction.setSenderIfNotSet(this.address)
        txBytes = await options.transaction.build({
          client: legacyJsonRpc as any
        })
      } else {
        txBytes = options.transaction
      }
      const result = await legacyJsonRpc.dryRunTransactionBlock({
        transactionBlock: txBytes
      })
      return normalizeTransactionResult('dryRun', result)
    }

    const core = getCoreTransactionClient(this.client)
    if (typeof core?.executeTransaction === 'function') {
      let txBytes: Uint8Array
      if (options.transaction instanceof Transaction) {
        options.transaction.setSenderIfNotSet(this.address)
        txBytes = await options.transaction.build({
          client: this.client as any
        })
      } else {
        txBytes = options.transaction
      }
      const signed = await this.signer.signTransaction(txBytes)
      const result = await core.executeTransaction({
        transaction: fromBase64(signed.bytes),
        signatures: [signed.signature],
        include: transactionIncludeOptions(rest.options)
      })
      return normalizeTransactionResult('execute', result)
    }

    const legacyJsonRpc = this.clientBundle.legacyJsonRpc
    if (!legacyJsonRpc) {
      throw new Error(
        'WalletClient execution requires core.executeTransaction or an explicit legacyJsonRpc client'
      )
    }
    // Execute the actual transaction
    const result = await legacyJsonRpc.signAndExecuteTransaction({
      ...rest,
      options: mergeTransactionResponseOptions(rest.options),
      signer: this.signer
    } as any)
    return normalizeTransactionResult('execute', result)
  }

  /**
   * Gets the wallet address from the signer's public key
   * @returns The wallet address as a string
   */
  get address(): string {
    return this.signer.getPublicKey().toSuiAddress()
  }

  /**
   * Gets a specific module by name
   * @param name - The name of the module to retrieve
   * @returns The requested module instance
   */
  module<TName extends ModuleName>(name: TName): (typeof modules)[TName] {
    return this.modules[name]
  }

  /**
   * Gets the configuration for a specific module
   * @param name - The name of the module
   * @returns The merged configuration (default + user config)
   */
  config<TName extends ModuleName>(name: TName): ExtractModuleConfig<(typeof modules)[TName]> {
    const mergedConfig = {
      ...this.modules[name].defaultConfig,
      ...this.userConfigs[name]
    }
    return mergedConfig as ExtractModuleConfig<(typeof modules)[TName]>
  }

  /**
   * Checks if a module is available
   * @param name - The name of the module to check
   * @returns True if the module exists, false otherwise
   */
  hasModule(name: ModuleName): boolean {
    return name in this.modules
  }
}

export type { ModuleConfig }
