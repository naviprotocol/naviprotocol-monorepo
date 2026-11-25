import { Transaction } from '@mysten/sui/transactions'
import type { SuiClientTypes } from '@mysten/sui/client'
import { bcs } from '@mysten/sui/bcs'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import {
  getConfig,
  getMarket,
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
  LendingConfig,
  MarketSnapshot,
  MultiplySuiClient,
  NaviEnv,
  Strategy,
  RegistryKey
} from './types'
import {
  BN,
  RAY,
  address,
  check,
  inspect,
  recordReadVersion,
  sameCoin,
  coinType,
  jsonCopy,
  MultiplyError
} from './utils'
import { lendingToRaw, tokenDecimals } from './amounts'
import { resolveEMode } from './emode'

import {
  MAINNET_CAP_REGISTRY,
  accountCapType,
  assertRegistryUsable,
  normalizeEnv,
  normalizeCapRegistry,
  decodeRegistryEntries,
  indexRegistryStrategies,
  registryKeyString
} from './cap-registry'
import { strategies as builtInStrategies } from './strategies'
export { ACCOUNT_CAP_TYPE } from './cap-registry'

type FeedLike = { coinType: string; ratioOracleId?: number | null }
/** A composite ratio feed (e.g. `VSUI/SUI.RR`) is listed under its asset's coin type with `ratioOracleId`. */
export const isRatioFeed = (feed: FeedLike) =>
  feed.ratioOracleId !== undefined && feed.ratioOracleId !== null

/**
 * Feeds a strategy PTB must push: each strategy coin's own feed, plus its ratio feed when the
 * asset is composite-priced (price = own feed x ratio, valid only while both are fresh; abort 1502
 * otherwise). Anything ambiguous fails closed (ST-07..ST-10).
 */
export function selectStrategyFeeds<F extends FeedLike>(feeds: F[], strategy: Strategy): F[] {
  const selected: F[] = []
  for (const coin of new Set([
    coinType(strategy.collateralCoinType),
    coinType(strategy.debtCoinType)
  ])) {
    const forCoin = feeds.filter((f) => sameCoin(f.coinType, coin))
    const own = forCoin.filter((f) => !isRatioFeed(f))
    const ratio = forCoin.filter(isRatioFeed)
    check(
      own.length === 1,
      'MARKET_UNSUPPORTED',
      `Expected one own price feed for ${coin}, found ${own.length}`
    )
    check(
      ratio.length <= 1,
      'MARKET_UNSUPPORTED',
      `Expected at most one ratio feed for ${coin}, found ${ratio.length}`
    )
    selected.push(own[0], ...ratio)
  }
  return selected
}

export const defaultClient = () =>
  new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' })
export function createNaviDataSource(
  options: {
    client?: MultiplySuiClient
    services?: NaviSdkServiceOptions
    capRegistry?: CapRegistryConfig
    strategies?: Strategy[]
    retiredRegistryKeys?: RegistryKey[]
    /** Versions of objects actually read, delivered only after validation. */
    onReadEvidence?: (kind: 'caps' | 'position', versions: Record<string, string>) => void
    /** Optional request-scoped instrumentation. The wrapper must run each read exactly once. */
    measure?: <T>(stage: string, read: () => Promise<T>) => Promise<T>
    /** NAVI deployment for every read and PTB. Omitted means `prod`. */
    env?: NaviEnv
  } = {}
): DataSource {
  const env = normalizeEnv(options.env)
  const client = options.client ?? defaultClient()
  const explicitRegistry = options.capRegistry !== undefined
  const capRegistry = normalizeCapRegistry(options.capRegistry ?? MAINNET_CAP_REGISTRY)
  const byKey = indexRegistryStrategies(
    jsonCopy(options.strategies ?? Object.values(builtInStrategies))
  )
  const retired = new Set((options.retiredRegistryKeys ?? []).map(registryKeyString))
  check(
    [...retired].every((key) => !byKey.has(key)),
    'INVALID_ARGUMENT',
    'Active and retired Registry keys overlap'
  )
  const measure = options.measure ?? (<T>(_stage: string, read: () => Promise<T>) => read())
  // ST-01: with env omitted the lending reads get exactly the options they had before env existed.
  const opts = {
    services: options.services,
    disableCache: true,
    ...(options.env === undefined ? {} : { env })
  }
  async function updateOracle(tx: Transaction, strategy: Strategy, config: LendingConfig) {
    const feeds = selectStrategyFeeds(config.oracle.feeds, strategy)
    await updateOraclePricesPTB(tx, feeds, {
      ...opts,
      market: strategy.market,
      client,
      updatePythPriceFeeds: true
    })
  }
  const source: DataSource = {
    prepareOracle: (tx, strategy, market) => updateOracle(tx, strategy, market.config),
    capRegistry,
    env,
    async listAccountCaps(owner) {
      owner = address(owner)
      assertRegistryUsable(env, explicitRegistry)
      const capType = accountCapType(env)
      try {
        const registry = new Transaction()
        registry.setSender(owner)
        registry.moveCall({
          target: `${capRegistry.packageId}::multiply_registry::find_user_mul_account_caps`,
          arguments: [registry.object(capRegistry.objectId), registry.pure.address(owner)]
        })
        const versions = options.onReadEvidence ? {} : undefined
        const registered = await inspect(client, registry, versions)
        const allEntries = decodeRegistryEntries(registered[0]?.returnValues)
        check(
          allEntries.every((entry) => entry.capId !== address('0x0')),
          'INVALID_ACCOUNT_CAP',
          'Registry contains a zero Cap'
        )
        check(
          new Set(allEntries.map((entry) => entry.capId)).size === allEntries.length,
          'DUPLICATE_ACCOUNT_CAP',
          'One Cap is registered to multiple strategies'
        )
        const entries = allEntries.filter(
          (entry) => !retired.has(registryKeyString(entry.registryKey))
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
        const caps = entries.map((entry, i): AccountCap => {
          const object = objects.get(entry.capId)
          check(
            object && coinType(object.type) === capType,
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
            !accountOwners.has(fields.owner),
            'DUPLICATE_ACCOUNT_CAP',
            'Multiple strategies share one lending account'
          )
          accountOwners.add(fields.owner)
          if (versions) recordReadVersion(versions, entry.capId, object.version)
          return {
            id: entry.capId,
            accountOwner: fields.owner,
            strategyId: definitions[i].id,
            registryKey: { ...entry.registryKey }
          }
        })
        if (versions) options.onReadEvidence?.('caps', versions)
        return caps
      } catch (error) {
        if (error instanceof MultiplyError) throw error
        throw new MultiplyError('READ_FAILED', 'Unable to read complete Multiply Registry snapshot')
      }
    },
    async readMarket(strategy) {
      const tx = new Transaction()
      const configRead = measure('market_config', () =>
        getConfig({ ...opts, market: strategy.market })
      )
      // The oracle update needs only the config's feeds, so it runs beside the other reads.
      // It is the only writer of `tx` until it resolves; every later command follows it.
      const oracleUpdate = configRead.then((config) =>
        measure('market_oracle', () => updateOracle(tx, strategy, config))
      )
      const [config, lendingMarket, flashConfig, flashAssets] = await Promise.all([
        configRead,
        measure('market_pools', () => getMarket(strategy.market, opts)),
        measure('flash_config', () => getConfig({ ...opts, market: 'main' })),
        measure('flash_assets', () => getAllFlashLoanAssets({ ...opts, market: 'main' })),
        oracleUpdate
      ])
      const pools = lendingMarket.pools
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
      const emode = await resolveEMode(client, strategy, config, lendingMarket, collateral, debt)
      tokenDecimals(collateral)
      tokenDecimals(debt)
      const market: MarketSnapshot = {
        config,
        ...(emode ? { emode: { id: emode.emodeId, active: emode.isActive } } : {}),
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
      const results = await measure('market_inspect', () => inspect(client, tx))
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
      if (emode) {
        const asset = emode.assets.find((a) => a.assetId === collateral.id)!
        market.ltv = new BN(asset.ltv).toFixed()
        market.liquidationThreshold = new BN(asset.lt).toFixed()
      }
      // E-Mode overrides collateral LTV/LT; protocol logic still weights debt per reserve.
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
      const versions = options.onReadEvidence ? {} : undefined
      const results = await inspect(client, tx, versions)
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
      const amounts = {
        collateralAmount: lendingToRaw(collateralAmount, tokenDecimals(market.collateral)),
        debtAmount: lendingToRaw(debtAmount, tokenDecimals(market.debt), true),
        protocolCollateralAmount: collateralAmount,
        protocolDebtAmount: debtAmount
      }
      if (versions) options.onReadEvidence?.('position', versions)
      return amounts
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
