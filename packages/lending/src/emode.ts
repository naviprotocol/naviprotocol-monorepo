import {
  CacheOption,
  EnvOption,
  EModeCap,
  AccountCapOption,
  MarketOption,
  TransactionResult,
  SuiClientOption
} from './types'
import { withSingleton, withCache, parseTxValue, suiClient } from './utils'
import { DEFAULT_MARKET_IDENTITY, getMarket, getMarketConfig } from './market'
import { getConfig, DEFAULT_CACHE_TIME } from './config'
import { Transaction } from '@mysten/sui/transactions'
import { createAccountCapPTB, getAccountCapOwnerPTB } from './account-cap'
import { bcs } from '@mysten/sui/bcs'

export async function enterEModePTB(
  tx: Transaction,
  emodeId: number | TransactionResult,
  options?: Partial<EnvOption & AccountCapOption & MarketOption>
): Promise<Transaction> {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  if (!options?.accountCap) {
    tx.moveCall({
      target: `${config.package}::lending::enter_emode`,
      arguments: [tx.object(config.storage), parseTxValue(emodeId, tx.pure.u64)]
    })
  } else {
    tx.moveCall({
      target: `${config.package}::lending::enter_emode_with_account_cap`,
      arguments: [
        tx.object(config.storage),
        parseTxValue(emodeId, tx.pure.u64),
        parseTxValue(options.accountCap, tx.object)
      ]
    })
  }

  return tx
}

export async function exitEModePTB(
  tx: Transaction,
  options?: Partial<EnvOption & AccountCapOption & MarketOption>
): Promise<Transaction> {
  const config = await getConfig({
    ...options,
    cacheTime: DEFAULT_CACHE_TIME
  })
  if (!options?.accountCap) {
    tx.moveCall({
      target: `${config.package}::lending::exit_emode`,
      arguments: [tx.object(config.storage)]
    })
  } else {
    tx.moveCall({
      target: `${config.package}::lending::exit_emode_with_account_cap`,
      arguments: [tx.object(config.storage), parseTxValue(options.accountCap, tx.object)]
    })
  }
  return tx
}

export async function createEModeCapPTB(
  tx: Transaction,
  emodeId: number | TransactionResult,
  options?: Partial<EnvOption & MarketOption>
) {
  const config = await getConfig({
    cacheTime: DEFAULT_CACHE_TIME,
    ...options
  })
  const accountCap = await createAccountCapPTB(tx, options)
  await enterEModePTB(tx, emodeId, {
    ...options,
    accountCap: accountCap
  })
  const market = await getMarketConfig(options?.market || DEFAULT_MARKET_IDENTITY)
  const accountCapOwner = await getAccountCapOwnerPTB(tx, accountCap, options)
  tx.moveCall({
    target: `${config.emode.contract.registryPackage}::registry::register_emode_for_account_cap`,
    arguments: [
      tx.object(config.emode.contract.registryObject),
      accountCapOwner,
      parseTxValue(market.id, tx.pure.u64),
      parseTxValue(emodeId, tx.pure.u64)
    ]
  })
  return accountCap
}

export const getUserEModeCaps = withCache(
  withSingleton(
    async (
      address: string,
      options?: Partial<SuiClientOption & EnvOption & CacheOption>
    ): Promise<EModeCap[]> => {
      const config = await getConfig({
        cacheTime: DEFAULT_CACHE_TIME,
        ...options
      })
      const tx = new Transaction()
      const client = options?.client ?? suiClient

      tx.moveCall({
        target: `${config.emode.contract.registryPackage}::registry::find_user_emode_account_caps`,
        arguments: [tx.object(config.emode.contract.registryObject), tx.pure.address(address!)]
      })

      const result: any = await client.devInspectTransactionBlock({
        transactionBlock: tx,
        sender: address
      })

      const values = result.results[0].returnValues

      const marketIds = bcs.vector(bcs.u64()).parse(Uint8Array.from(values[0][0]))
      const emodeIds = bcs.vector(bcs.u64()).parse(Uint8Array.from(values[1][0]))
      const accountCaps = bcs.vector(bcs.Address).parse(Uint8Array.from(values[2][0]))

      return marketIds.map((marketId, index) => ({
        marketId: Number(marketId),
        emodeId: Number(emodeIds[index]),
        accountCap: accountCaps[index].toString()
      }))
    }
  )
)
