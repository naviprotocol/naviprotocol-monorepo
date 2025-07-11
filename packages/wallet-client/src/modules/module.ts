import { WalletClient } from '../client'
import { ModuleName } from '.'

export interface ModuleConfig {
  [key: string]: any
}

export type ModuleEvents = {
  [key: string]: any
}

export abstract class Module<TConfig extends ModuleConfig, TEvents extends ModuleEvents> {
  abstract readonly name: string
  abstract readonly defaultConfig: TConfig
  protected walletClient?: WalletClient

  get config(): TConfig {
    return this.walletClient
      ? (this.walletClient.config(this.name as ModuleName) as unknown as TConfig)
      : this.defaultConfig
  }

  emit(event: keyof TEvents, data: TEvents[keyof TEvents]) {
    this.walletClient?.events.emit(event as any, data)
  }

  install(walletClient: WalletClient): void {
    this.walletClient = walletClient
  }

  uninstall() {
    this.walletClient = undefined
  }
}
