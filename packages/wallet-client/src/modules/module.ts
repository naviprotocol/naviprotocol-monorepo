/**
 * Wallet Client Module System
 *
 * This module defines the base architecture for the wallet client's modular system.
 * It provides the foundation for different functionality modules like swap, lending,
 * balance management, and other DeFi operations.
 *
 * @module WalletClientModule
 */

import { WalletClient } from '../client'
import { ModuleName } from '.'

/**
 * Base interface for module configuration
 *
 * All modules must implement this interface to define their configuration structure.
 */
export interface ModuleConfig {
  [key: string]: any
}

/**
 * Base interface for module events
 *
 * All modules must implement this interface to define their event structure.
 */
export type ModuleEvents = {
  [key: string]: any
}

/**
 * Abstract base class for all wallet client modules
 *
 * This class provides the foundation for modular functionality in the wallet client.
 * Each module (swap, lending, balance, etc.) extends this class to provide
 * specific functionality while maintaining a consistent interface.
 *
 * @template TConfig - The configuration type for this module
 * @template TEvents - The events type for this module
 */
export abstract class Module<TConfig extends ModuleConfig, TEvents extends ModuleEvents> {
  /** The unique name identifier for this module */
  abstract readonly name: string

  /** Default configuration values for this module */
  abstract readonly defaultConfig: TConfig

  /** Reference to the wallet client instance that owns this module */
  protected walletClient?: WalletClient

  /**
   * Gets the current configuration for this module
   *
   * This combines the default configuration with any user-provided overrides
   * from the wallet client configuration.
   *
   * @returns The merged configuration for this module
   */
  get config(): TConfig {
    return this.walletClient
      ? (this.walletClient.config(this.name as ModuleName) as unknown as TConfig)
      : this.defaultConfig
  }

  /**
   * Emits an event through the wallet client's event system
   *
   * @param event - The event name to emit
   * @param data - The event data to emit
   */
  emit(event: keyof TEvents, data: TEvents[keyof TEvents]) {
    this.walletClient?.events.emit(event as any, data)
  }

  /**
   * Installs this module into a wallet client
   *
   * This method is called by the wallet client during initialization
   * to establish the connection between the module and the client.
   *
   * @param walletClient - The wallet client instance to install into
   */
  install(walletClient: WalletClient): void {
    this.walletClient = walletClient
  }

  /**
   * Uninstalls this module from the wallet client
   *
   * This method removes the reference to the wallet client,
   * effectively disconnecting the module.
   */
  uninstall() {
    this.walletClient = undefined
  }
}
