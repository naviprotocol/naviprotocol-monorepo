import { BalanceModule, Events as BalanceEvents } from './balanceModule'
import { LendingModule, Events as LendingEvents } from './lendingModule'
import { VoloModule, Events as VoloEvents } from './voloModule'
import { SwapModule, Events as SwapEvents } from './swapModule'
import { HaedalModule, Events as HaedalEvents } from './haedalModule'

export const modules = {
  balance: new BalanceModule(),
  lending: new LendingModule(),
  volo: new VoloModule(),
  swap: new SwapModule(),
  haedal: new HaedalModule()
}

export type ModuleEvents = BalanceEvents & LendingEvents & VoloEvents & SwapEvents & HaedalEvents

export type ModuleName = keyof typeof modules
export type Module = (typeof modules)[ModuleName]
export type ModuleConfig = Module['defaultConfig']
