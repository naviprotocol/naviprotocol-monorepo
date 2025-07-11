import { SuiClient, SuiClientOptions, type ExecuteTransactionBlockParams } from '@mysten/sui/client'
import { Signer } from '@mysten/sui/cryptography'
import mitt, { Emitter } from 'mitt'
import { CustomTransport } from './transport'
import { Module, ModuleConfig } from './modules/module'
import { modules, ModuleName, ModuleEvents } from './modules'
import { Transaction } from '@mysten/sui/transactions'
import { DryRunOptions } from './types'
import { getFullnodeUrl } from '@mysten/sui/client'

type ExtractModuleConfig<T> = T extends Module<infer TConfig, any> ? TConfig : never

export type UserConfigs = {
  [K in ModuleName]: Partial<ExtractModuleConfig<(typeof modules)[K]>>
}

export type WalletClientOptions = {
  signer: Signer
  configs?: Partial<UserConfigs>
  client?: SuiClientOptions
}

const defaultClientOptions: SuiClientOptions = {
  url: getFullnodeUrl('mainnet')
}

export class WalletClient {
  public readonly signer: Signer
  private readonly modules = modules
  private readonly userConfigs: Partial<UserConfigs> = {}
  public readonly events: Emitter<ModuleEvents> = mitt()
  public readonly client: SuiClient

  constructor(options: WalletClientOptions) {
    const clientOptions = {
      ...defaultClientOptions,
      ...options.client
    }
    clientOptions.transport = clientOptions.transport || new CustomTransport(clientOptions.url)

    this.client = new SuiClient(clientOptions as any)
    this.signer = options.signer
    this.userConfigs = options.configs || {}

    Object.entries(this.modules).forEach(([name, module]) => {
      if (name !== module.name) {
        throw new Error(`Module name ${name} does not match module name ${module.name}`)
      }
      module.install(this)
    })
  }

  async signExecuteTransaction(
    options: {
      transaction: Uint8Array | Transaction
    } & Omit<ExecuteTransactionBlockParams, 'transactionBlock' | 'signature'> &
      Partial<DryRunOptions>
  ) {
    const { dryRun = false, ...rest } = options
    if (dryRun) {
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
    return this.client.signAndExecuteTransaction({
      ...rest,
      signer: this.signer
    })
  }

  get address(): string {
    return this.signer.getPublicKey().toSuiAddress()
  }

  module<TName extends ModuleName>(name: TName): (typeof modules)[TName] {
    return this.modules[name]
  }

  config<TName extends ModuleName>(name: TName): ExtractModuleConfig<(typeof modules)[TName]> {
    const mergedConfig = {
      ...this.modules[name].defaultConfig,
      ...this.userConfigs[name]
    }
    return mergedConfig as ExtractModuleConfig<(typeof modules)[TName]>
  }

  hasModule(name: ModuleName): boolean {
    return name in this.modules
  }
}

export type { ModuleConfig }
