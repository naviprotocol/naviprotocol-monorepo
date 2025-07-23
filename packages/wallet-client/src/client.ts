/**
 * Wallet Client - Core Client Implementation
 *
 * This module provides the main wallet client for interacting with the Sui blockchain.
 * It manages transaction signing, module integration, and provides a unified interface
 * for various DeFi operations including swaps, lending, and balance management.
 *
 * @module WalletClient
 */

import { SuiClient, SuiClientOptions, type ExecuteTransactionBlockParams } from '@mysten/sui/client'
import { Signer } from '@mysten/sui/cryptography'
import mitt, { Emitter } from 'mitt'
import { CustomTransport } from './transport'
import { Module, ModuleConfig } from './modules/module'
import { modules, ModuleName, ModuleEvents } from './modules'
import { Transaction } from '@mysten/sui/transactions'
import { DryRunOptions } from './types'
import { getFullnodeUrl } from '@mysten/sui/client'

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
  /** Optional Sui client configuration */
  client?: SuiClientOptions
}

/**
 * Default client options pointing to mainnet
 */
const defaultClientOptions: SuiClientOptions = {
  url: getFullnodeUrl('mainnet')
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
  public readonly client: SuiClient

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
    // Merge default and user-provided client options
    const clientOptions = {
      ...defaultClientOptions,
      ...options.client
    }
    clientOptions.transport = clientOptions.transport || new CustomTransport(clientOptions.url)
    // Initialize the Sui client
    this.client = new SuiClient(clientOptions as any)
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
    } & Omit<ExecuteTransactionBlockParams, 'transactionBlock' | 'signature'> &
      Partial<DryRunOptions>
  ) {
    const { dryRun = false, ...rest } = options

    if (dryRun) {
      // Handle dry run mode for transaction simulation
      let txBytes
      if (options.transaction instanceof Transaction) {
        options.transaction.setSenderIfNotSet(this.address)
        txBytes = await options.transaction.build({
          client: this.client
        })
      } else {
        txBytes = options.transaction
      }
      return this.client.dryRunTransactionBlock({
        transactionBlock: txBytes
      })
    }

    // Execute the actual transaction
    return this.client.signAndExecuteTransaction({
      ...rest,
      signer: this.signer
    })
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
