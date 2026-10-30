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
import type { AccountCap, DataSource, MarketSnapshot, MultiplySuiClient, Strategy } from './types'
import { BN, RAY, address, check, inspect, sameCoin } from './utils'

// AccountCap's canonical type origin, preserved across lending package upgrades.
// This differs from the current callable package and the AccountField type origin.
export const ACCOUNT_CAP_TYPE =
  '0x66c91a8560cd64d73d93dd1ec7b61f3f21ad2f66553dd3d7038ca69255479bb7::account::AccountCap'
export const defaultClient = () =>
  new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' })
export function createNaviDataSource(
  options: { client?: MultiplySuiClient; services?: NaviSdkServiceOptions } = {}
): DataSource {
  const client = options.client ?? defaultClient()
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
    async listAccountCaps(owner) {
      address(owner)
      const config = await getConfig(opts)
      const registry = new Transaction()
      registry.moveCall({
        target: `${config.emode.contract.registryPackage}::registry::find_user_emode_account_caps`,
        arguments: [
          registry.object(config.emode.contract.registryObject),
          registry.pure.address(owner)
        ]
      })
      const registered = await inspect(client, registry)
      const emodeOwners = new Set(bcs.vector(bcs.Address).parse(registered[0].returnValues[2].bcs))
      const caps: AccountCap[] = []
      const cursors = new Set<string>()
      let cursor: string | null = null
      do {
        const page: SuiClientTypes.ListOwnedObjectsResponse<{ json: true }> =
          await client.core.listOwnedObjects({
            owner,
            type: ACCOUNT_CAP_TYPE,
            include: { json: true },
            cursor,
            limit: 50
          })
        for (const object of page.objects) {
          const accountOwner = address(String(object.json?.owner))
          // Product E-Mode Caps remain excluded even if externally renamed.
          if (emodeOwners.has(accountOwner)) continue
          const fields = await client.core.listDynamicFields({
            parentId: object.objectId,
            limit: 50
          })
          check(!fields.hasNextPage, 'READ_FAILED', 'Unexpected AccountCap metadata size')
          const field = fields.dynamicFields.find((f) =>
            f.name.type.endsWith('::account::AccountFieldKey')
          )
          if (!field) continue
          const metadata = await client.core.getDynamicField({
            parentId: object.objectId,
            name: field.name
          })
          const schema = bcs.struct('AccountField', {
            name: bcs.string(),
            description: bcs.string(),
            last_update_time: bcs.string(),
            market_balance: bcs.string()
          })
          const value = schema.parse(metadata.dynamicField.value.bcs)
          const prefix = 'navi:multiply:v1:'
          if (!value.name.startsWith(prefix)) continue
          const strategy = JSON.parse(value.description) as Strategy
          check(
            strategy?.id === value.name.slice(prefix.length),
            'INVALID_ACCOUNT_CAP',
            'Multiply Cap metadata has no matching strategy binding'
          )
          caps.push({
            id: object.objectId,
            accountOwner,
            strategyId: strategy.id,
            name: value.name,
            strategy
          })
        }
        if (!page.hasNextPage) break
        check(
          page.cursor && !cursors.has(page.cursor),
          'READ_FAILED',
          'AccountCap pagination did not advance'
        )
        cursor = page.cursor
        cursors.add(cursor)
      } while (true)
      return caps
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
      check(
        collateral.token.decimals === 9 && debt.token.decimals === 9,
        'MARKET_UNSUPPORTED',
        'Initial release supports nine-decimal pools'
      )
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
      return { collateralAmount, debtAmount }
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
