/**
 * Wallet Client Modules - Main Index
 *
 * This module serves as the central registry for all wallet client modules.
 * It imports and exports all available modules (balance, lending, volo, swap, haedal)
 * and provides type definitions for module management.
 *
 * @module WalletClientModules
 */

import { BalanceModule, Events as BalanceEvents } from './balanceModule'
import { LendingModule, Events as LendingEvents } from './lendingModule'
import { VoloModule, Events as VoloEvents } from './voloModule'
import { SwapModule, Events as SwapEvents } from './swapModule'
import { HaedalModule, Events as HaedalEvents } from './haedalModule'

/**
 * Registry of all available wallet client modules
 *
 * This object contains instances of all modules that provide different
 * functionalities for the wallet client (balance management, lending,
 * volo operations, swapping, and haedal integration).
 */
export const modules = {
  /** Balance management module */
  balance: new BalanceModule(),
  /** Lending protocol module */
  lending: new LendingModule(),
  /** Volo protocol module */
  volo: new VoloModule(),
  /** DEX swapping module */
  swap: new SwapModule(),
  /** Haedal protocol module */
  haedal: new HaedalModule()
}

/**
 * Union type of all module events
 *
 * This type combines all event types from different modules,
 * allowing the wallet client to handle events from any module.
 */
export type ModuleEvents = BalanceEvents & LendingEvents & VoloEvents & SwapEvents & HaedalEvents

/**
 * Type for module names
 *
 * This type represents the keys of the modules object,
 * allowing type-safe access to specific modules.
 */
export type ModuleName = keyof typeof modules

/**
 * Type for module instances
 *
 * This type represents any module instance from the modules registry.
 */
export type Module = (typeof modules)[ModuleName]

/**
 * Type for module configurations
 *
 * This type represents the configuration type of any module,
 * extracted from the defaultConfig property.
 */
export type ModuleConfig = Module['defaultConfig']
