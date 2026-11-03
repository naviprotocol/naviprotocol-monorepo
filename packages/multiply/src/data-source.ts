import { Transaction } from '@mysten/sui/transactions'
import type { SuiClientTypes } from '@mysten/sui/client'
import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import {
  getConfig,
  getPools,
  getAllFlashLoanAssets,
  updateOraclePricesPTB,
  ReserveDataInfo,
  UserStateInfo,
  type NaviSdkServiceOptions
} from '@naviprotocol/lending'
import type {
  AccountCap,
  CapRegistryConfig,
  DataSource,
  MarketSnapshot,
  MultiplySuiClient,
  Strategy
} from './types'
import {
  BN,
  RAY,
  address,
  check,
  inspect,
  sameCoin,
  coinType,
  jsonCopy,
  MultiplyError
} from './utils'
import { lendingToRaw, tokenDecimals } from './amounts'

import {
  ACCOUNT_CAP_TYPE,
  MAINNET_CAP_REGISTRY,
  normalizeCapRegistry,
  decodeRegistryEntries,
  indexRegistryStrategies
} from './cap-registry'
import { strategies as builtInStrategies } from './strategies'
export { ACCOUNT_CAP_TYPE } from './cap-registry'

export const defaultClient = () =>
  new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' })
export function createNaviDataSource(
  options: {
    client?: MultiplySuiClient
    services?: NaviSdkServiceOptions
    capRegistry?: CapRegistryConfig
    strategies?: Strategy[]
  } = {}
): DataSource {
  const client = options.client ?? defaultClient()
  const capRegistry = normalizeCapRegistry(options.capRegistry ?? MAINNET_CAP_REGISTRY)
  const byKey = indexRegistryStrategies(
    jsonCopy(options.strategies ?? Object.values(builtInStrategies))
  )
  const opts = { services: options.services, disableCache: true }
  async function prepareOracle(tx: Transaction, strategy: Strategy, market: MarketSnapshot) {
    const feeds = market.config.oracle.feeds.filter(
      (f) =>
        sameCoin(f.coinType, strategy.collateralCoinType) ||
        sameCoin(f.coinType, strategy.debtCoinType)
    )
    check(feeds.length === 2, 'MARKET_UNSUPPORTED', 'Both strategy price feeds are required')
    await updateOraclePricesPTB(tx, feeds, {
      ...opts,
      market: strategy.market,
      client,
      updatePythPriceFeeds: true
    })
  }
  const source: DataSource = {
    prepareOracle,
    capRegistry,
    async listAccountCaps(owner) {
      owner = address(owner)
      try {
        const config = await getConfig(opts)
        const registry = new Transaction()
        registry.setSender(owner)
        registry.moveCall({
          target: `${capRegistry.packageId}::multiply_registry::find_user_mul_account_caps`,
          arguments: [registry.object(capRegistry.objectId), registry.pure.address(owner)]
        })
        registry.moveCall({
          target: `${config.emode.contract.registryPackage}::registry::find_user_emode_account_caps`,
          arguments: [
            registry.object(config.emode.contract.registryObject),
            registry.pure.address(owner)
          ]
        })
        const registered = await inspect(client, registry)
        const entries = decodeRegistryEntries(registered[0]?.returnValues)
        check(
          registered[1]?.returnValues?.length === 3,
          'READ_FAILED',
          'Incomplete E-Mode registry response'
        )
        const emodeOwners = new Set(
          bcs.vector(bcs.Address).parse(registered[1].returnValues[2].bcs)
        )
        const definitions = entries.map((entry) => {
          const key = `${entry.registryKey.strategyNumericId}:${entry.registryKey.strategyVersion}`
          const strategy = byKey.get(key)
          check(
            strategy,
            'UNSUPPORTED_REGISTRY_STRATEGY',
            `Unknown Multiply Registry strategy: ${key}`
          )
          check(
            entry.capId !== address('0x0'),
            'INVALID_ACCOUNT_CAP',
            'Registry contains a zero Cap'
          )
          return strategy
        })
        check(
          new Set(entries.map((e) => e.capId)).size === entries.length,
          'DUPLICATE_ACCOUNT_CAP',
          'One Cap is registered to multiple strategies'
        )
        const objects = new Map<string, SuiClientTypes.Object<{ content: true }>>()
        for (let start = 0; start < entries.length; start += 50) {
          const ids = entries.slice(start, start + 50).map((e) => e.capId)
          const response = await client.core.getObjects({
            objectIds: ids,
            include: { content: true }
          })
          check(
            response.objects.length === ids.length,
            'READ_FAILED',
            'Incomplete Cap object response'
          )
          for (const object of response.objects) {
            check(
              !(object instanceof Error),
              'INVALID_ACCOUNT_CAP',
              'Registered Cap is unavailable'
            )
            const id = address(object.objectId)
            check(
              ids.includes(id) && !objects.has(id),
              'READ_FAILED',
              'Unexpected or duplicate Cap response'
            )
            objects.set(id, object)
          }
        }
        const accountOwners = new Set<string>()
        const schema = bcs.struct('AccountCap', { id: bcs.Address, owner: bcs.Address })
        return entries.map((entry, i): AccountCap => {
          const object = objects.get(entry.capId)
          check(
            object && coinType(object.type) === ACCOUNT_CAP_TYPE,
            'INVALID_ACCOUNT_CAP',
            'Registry object is not an AccountCap'
          )
          check(
            object.owner.$kind === 'AddressOwner' && address(object.owner.AddressOwner) === owner,
            'INVALID_ACCOUNT_CAP',
            'Registered Cap is not owned by this wallet'
          )
          let fields: { id: string; owner: string }
          try {
            fields = schema.parse(object.content)
          } catch {
            throw new MultiplyError('INVALID_ACCOUNT_CAP', 'Invalid AccountCap content')
          }
          check(
            fields.id === entry.capId && fields.owner !== address('0x0'),
            'INVALID_ACCOUNT_CAP',
            'Invalid AccountCap identity'
          )
          check(
            !emodeOwners.has(fields.owner),
            'INVALID_ACCOUNT_CAP',
            'E-Mode Cap cannot be used for Multiply'
          )
          check(
            !accountOwners.has(fields.owner),
            'DUPLICATE_ACCOUNT_CAP',
            'Multiple strategies share one lending account'
          )
          accountOwners.add(fields.owner)
          return {
            id: entry.capId,
            accountOwner: fields.owner,
            strategyId: definitions[i].id,
            registryKey: { ...entry.registryKey }
          }
        })
      } catch (error) {
        if (error instanceof MultiplyError) throw error
        throw new MultiplyError('READ_FAILED', 'Unable to read complete Multiply Registry snapshot')
      }
    },
    async readMarket(strategy) {
      const [config, pools, flashConfig, flashAssets] = await Promise.all([
        getConfig({ ...opts, market: strategy.market }),
        getPools({ ...opts, markets: [strategy.market] }),
        getConfig({ ...opts, market: 'main' }),
        getAllFlashLoanAssets({ ...opts, market: 'main' })
      ])
      const collateral = pools.find((p) => sameCoin(p.suiCoinType, strategy.collateralCoinType))
      const debt = pools.find((p) => sameCoin(p.suiCoinType, strategy.debtCoinType))
      const flash = flashAssets.find((p) => sameCoin(p.coinType, strategy.debtCoinType))
      check(
        collateral && debt && flash,
        'MARKET_UNSUPPORTED',
        'Missing collateral, debt or main-market flash liquidity'
      )
      check(
        config.version === 2 && config.limter,
        'MARKET_UNSUPPORTED',
        'Requires lending v2 and an on-chain HF limiter'
      )
      tokenDecimals(collateral)
      tokenDecimals(debt)
      const market: MarketSnapshot = {
        config,
        collateral,
        debt,
        collateralPrice: '',
        debtPrice: '',
        ltv: '',
        liquidationThreshold: '',
        borrowWeight: '',
        flash: {
          config: flashConfig,
          poolId: flash.poolId,
          max: flash.max,
          min: flash.min,
          feeBps: '0'
        },
        observedAt: Date.now()
      }
      const tx = new Transaction()
      await prepareOracle(tx, strategy, market)
      const priceIndices = [collateral, debt].map((p) => {
        const i = tx.getData().commands.length
        tx.moveCall({
          target: `${config.package}::calculator::calculate_value`,
          arguments: [
            tx.object('0x6'),
            tx.object(config.priceOracle),
            tx.pure.u256('1000000000000000000'),
            tx.pure.u8(p.oracleId)
          ]
        })
        return i
      })
      const riskIndex = tx.getData().commands.length
      tx.moveCall({
        target: `${config.uiGetter}::getter::get_reserve_data`,
        arguments: [tx.object(config.storage)]
      })
      tx.moveCall({
        target: `${config.package}::storage::get_borrow_weight`,
        arguments: [tx.object(config.storage), tx.pure.u8(debt.id)]
      })
      tx.moveCall({
        target: `${flashConfig.package}::flash_loan::get_asset`,
        typeArguments: [strategy.debtCoinType],
        arguments: [tx.object(flashConfig.flashloanConfig)]
      })
      const results = await inspect(client, tx)
      const flashValues = results[riskIndex + 2].returnValues
      check(
        bcs.Address.parse(flashValues[3].bcs) === flash.poolId,
        'READ_FAILED',
        'Flash pool differs from live configuration'
      )
      market.flash.feeBps = (
        BigInt(bcs.u64().parse(flashValues[4].bcs)) + BigInt(bcs.u64().parse(flashValues[5].bcs))
      ).toString()
      market.flash.max = bcs.u64().parse(flashValues[6].bcs)
      market.flash.min = bcs.u64().parse(flashValues[7].bcs)
      market.collateralPrice = new BN(
        bcs.u256().parse(results[priceIndices[0]].returnValues[0].bcs)
      )
        .div('1e18')
        .toFixed()
      market.debtPrice = new BN(bcs.u256().parse(results[priceIndices[1]].returnValues[0].bcs))
        .div('1e18')
        .toFixed()
      const reserves = bcs.vector(ReserveDataInfo).parse(results[riskIndex].returnValues[0].bcs)
      const reserve = reserves.find((r) => r.id === collateral.id)
      check(reserve, 'READ_FAILED', 'Missing collateral risk parameters')
      market.ltv = new BN(reserve.ltv).div(RAY.toString()).toFixed()
      market.liquidationThreshold = new BN(reserve.liquidation_threshold)
        .div(RAY.toString())
        .toFixed()
      market.borrowWeight = new BN(bcs.u64().parse(results[riskIndex + 1].returnValues[0].bcs))
        .div(10000)
        .toFixed()
      market.observedAt = Date.now()
      return market
    },
    async readPosition(cap, strategy, suppliedMarket) {
      const market = suppliedMarket ?? (await source.readMarket(strategy))
      const { config } = market
      const tx = new Transaction()
      tx.moveCall({
        target: `${config.package}::lending::update_state_of_user`,
        arguments: [tx.object('0x6'), tx.object(config.storage), tx.pure.address(cap.accountOwner)]
      })
      tx.moveCall({
        target: `${config.uiGetter}::getter::get_reserve_data`,
        arguments: [tx.object(config.storage)]
      })
      tx.moveCall({
        target: `${config.uiGetter}::getter_unchecked::get_user_state`,
        arguments: [tx.object(config.storage), tx.pure.address(cap.accountOwner)]
      })
      tx.moveCall({
        target: `${config.package}::storage::is_in_emode`,
        arguments: [tx.object(config.storage), tx.pure.address(cap.accountOwner)]
      })
      const results = await inspect(client, tx)
      check(
        !bcs.bool().parse(results[3].returnValues[0].bcs),
        'POSITION_UNSUPPORTED',
        'Account has an unsupported E-Mode override'
      )
      const reserves = bcs.vector(ReserveDataInfo).parse(results[1].returnValues[0].bcs)
      const states = bcs.vector(UserStateInfo).parse(results[2].returnValues[0].bcs)
      let collateralAmount = '0',
        debtAmount = '0'
      for (const state of states) {
        check(
          (state.asset_id === market.collateral.id || BigInt(state.supply_balance) === 0n) &&
            (state.asset_id === market.debt.id || BigInt(state.borrow_balance) === 0n),
          'POSITION_UNSUPPORTED',
          'Account contains assets outside this strategy'
        )
        const reserve = reserves.find((r) => r.id === state.asset_id)
        check(reserve, 'READ_FAILED', 'Position references an unknown reserve')
        if (state.asset_id === market.collateral.id)
          collateralAmount = (
            (BigInt(state.supply_balance) * BigInt(reserve.supply_index) + RAY / 2n) /
            RAY
          ).toString()
        if (state.asset_id === market.debt.id)
          debtAmount = (
            (BigInt(state.borrow_balance) * BigInt(reserve.borrow_index) + RAY / 2n) /
            RAY
          ).toString()
      }
      // NAVI's balances are normalized to 9 decimals. Coins, swaps, flash loans,
      // and all public Multiply amounts use each token's native precision.
      // Round available collateral down and liabilities up to avoid overstating equity.
      return {
        collateralAmount: lendingToRaw(collateralAmount, tokenDecimals(market.collateral)),
        debtAmount: lendingToRaw(debtAmount, tokenDecimals(market.debt), true)
      }
    },
    async readBorrowFeeBps(market, accountOwner) {
      const tx = new Transaction()
      // New Caps have no user override. Query the global/asset rate with a fresh simulated Cap owner.
      const owner = accountOwner
        ? tx.pure.address(accountOwner)
        : tx.moveCall({
            target: `${market.config.package}::account::account_owner`,
            arguments: [
              tx.moveCall({ target: `${market.config.package}::lending::create_account` })
            ]
          })
      const i = tx.getData().commands.length
      tx.moveCall({
        target: `${market.config.package}::incentive_v3::get_borrow_fee_v2`,
        arguments: [
          tx.object(market.config.incentiveV3),
          owner,
          tx.pure.u8(market.debt.id),
          tx.pure.u64(10000)
        ]
      })
      const result = await inspect(client, tx)
      return bcs.u64().parse(result[i].returnValues[0].bcs)
    }
  }
  return source
}
