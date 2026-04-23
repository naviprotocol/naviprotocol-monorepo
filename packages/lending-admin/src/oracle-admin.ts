import { encodePriceInput } from './precision'
import {
  oracleTarget,
  resolveAdminConfig,
  resolveAdminPTBContext,
  resolveOracleFeedByFeedId,
  resolveOracleFeedByOracleId
} from './ptb'
import type { PriceInput } from './types'
import type { AdminPTBOptions } from './ptb'

type OraclePriceRawOptions = AdminPTBOptions & {
  oracleId: number
  value: string
  priceDecimals: number
}

type OraclePriceOptions = AdminPTBOptions & {
  oracleId: number
  value: PriceInput
}

type OracleFeedPriceRawOptions = AdminPTBOptions & {
  feedId: string
  value: string
}

type OracleFeedPriceOptions = AdminPTBOptions & {
  feedId: string
  value: PriceInput
}

type OraclePriceBatchRawOptions = AdminPTBOptions & {
  updates: Array<{
    oracleId: number
    value: string
  }>
}

type OraclePriceBatchOptions = AdminPTBOptions & {
  updates: Array<{
    oracleId: number
    value: PriceInput
  }>
}

type OracleProviderKind = 'pyth' | 'supra' | 'switchboard'

function toByteVector(value: Uint8Array | number[]) {
  return Array.from(value)
}

function makeU64OracleConfigSetter(functionName: string) {
  return async (options: AdminPTBOptions & { feedId: string; value: string }) => {
    const { tx, config } = await resolveAdminPTBContext(options)

    tx.moveCall({
      target: oracleTarget(config, 'oracle_manage', functionName),
      arguments: [
        tx.object(config.oracle.oracleAdminCap),
        tx.object(config.oracle.oracleConfig),
        tx.pure.address(options.feedId),
        tx.pure.u64(options.value)
      ]
    })

    return tx
  }
}

function makeBooleanOracleConfigSetter(functionName: string) {
  return async (options: AdminPTBOptions & { feedId: string; value: boolean }) => {
    const { tx, config } = await resolveAdminPTBContext(options)

    tx.moveCall({
      target: oracleTarget(config, 'oracle_manage', functionName),
      arguments: [
        tx.object(config.oracle.oracleAdminCap),
        tx.object(config.oracle.oracleConfig),
        tx.pure.address(options.feedId),
        tx.pure.bool(options.value)
      ]
    })

    return tx
  }
}

function makeVectorOracleConfigSetter(functionName: string) {
  return async (
    options: AdminPTBOptions & {
      feedId: string
      pairId: Uint8Array | number[]
    }
  ) => {
    const { tx, config } = await resolveAdminPTBContext(options)

    tx.moveCall({
      target: oracleTarget(config, 'oracle_manage', functionName),
      arguments: [
        tx.object(config.oracle.oracleAdminCap),
        tx.object(config.oracle.oracleConfig),
        tx.pure.address(options.feedId),
        tx.pure.vector('u8', toByteVector(options.pairId))
      ]
    })

    return tx
  }
}

function makeOracleProviderToggle(functionName: string) {
  return async (options: AdminPTBOptions & { feedId: string }) => {
    const { tx, config } = await resolveAdminPTBContext(options)

    tx.moveCall({
      target: oracleTarget(config, 'oracle_manage', functionName),
      arguments: [
        tx.object(config.oracle.oracleAdminCap),
        tx.object(config.oracle.oracleConfig),
        tx.pure.address(options.feedId)
      ]
    })

    return tx
  }
}

async function buildOracleProvider(options: AdminPTBOptions, provider: OracleProviderKind) {
  const { tx, config } = await resolveAdminPTBContext(options)
  const [providerRef] = tx.moveCall({
    target: oracleTarget(config, 'oracle_provider', `${provider}_provider`)
  })

  return { tx, config, providerRef }
}

export async function createFeederPTB(options?: AdminPTBOptions) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: oracleTarget(config, 'oracle', 'create_feeder'),
    arguments: [tx.object(config.oracle.oracleAdminCap)]
  })

  return tx
}

export async function createOracleConfigPTB(options?: AdminPTBOptions) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: oracleTarget(config, 'oracle_manage', 'create_config'),
    arguments: [tx.object(config.oracle.oracleAdminCap)]
  })

  return tx
}

export async function versionMigrateOraclePTB(options?: AdminPTBOptions) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: oracleTarget(config, 'oracle_manage', 'version_migrate'),
    arguments: [
      tx.object(config.oracle.oracleAdminCap),
      tx.object(config.oracle.oracleConfig),
      tx.object(config.oracle.priceOracle)
    ]
  })

  return tx
}

export async function setOraclePausePTB(options: AdminPTBOptions & { paused: boolean }) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: oracleTarget(config, 'oracle_manage', 'set_pause'),
    arguments: [
      tx.object(config.oracle.oracleAdminCap),
      tx.object(config.oracle.oracleConfig),
      tx.pure.bool(options.paused)
    ]
  })

  return tx
}

export async function setUpdateIntervalPTB(
  options: AdminPTBOptions & {
    value: string
  }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: oracleTarget(config, 'oracle', 'set_update_interval'),
    arguments: [
      tx.object(config.oracle.oracleAdminCap),
      tx.object(config.oracle.priceOracle),
      tx.pure.u64(options.value)
    ]
  })

  return tx
}

export async function registerTokenPriceRawPTB(options: OraclePriceRawOptions) {
  const { tx, config, clock } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: oracleTarget(config, 'oracle', 'register_token_price'),
    arguments: [
      tx.object(config.oracle.oracleAdminCap),
      tx.object(clock),
      tx.object(config.oracle.priceOracle),
      tx.pure.u8(options.oracleId),
      tx.pure.u256(options.value),
      tx.pure.u8(options.priceDecimals)
    ]
  })

  return tx
}

export async function registerTokenPricePTB(options: OraclePriceOptions) {
  const config = await resolveAdminConfig(options)
  const feed = resolveOracleFeedByOracleId(config, options.oracleId)

  return registerTokenPriceRawPTB({
    ...options,
    config,
    value: encodePriceInput(options.value, feed.priceDecimal),
    priceDecimals: feed.priceDecimal
  })
}

export async function updateTokenPriceRawPTB(
  options: AdminPTBOptions & { oracleId: number; value: string }
) {
  const { tx, config, clock } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: oracleTarget(config, 'oracle', 'update_token_price'),
    arguments: [
      tx.object(config.oracle.oracleFeederCap),
      tx.object(clock),
      tx.object(config.oracle.priceOracle),
      tx.pure.u8(options.oracleId),
      tx.pure.u256(options.value)
    ]
  })

  return tx
}

export async function updateTokenPricePTB(options: OraclePriceOptions) {
  const config = await resolveAdminConfig(options)
  const feed = resolveOracleFeedByOracleId(config, options.oracleId)

  return updateTokenPriceRawPTB({
    ...options,
    config,
    value: encodePriceInput(options.value, feed.priceDecimal)
  })
}

export async function updateTokenPriceBatchRawPTB(options: OraclePriceBatchRawOptions) {
  const { tx, config, clock } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: oracleTarget(config, 'oracle', 'update_token_price_batch'),
    arguments: [
      tx.object(config.oracle.oracleFeederCap),
      tx.object(clock),
      tx.object(config.oracle.priceOracle),
      tx.pure.vector(
        'u8',
        options.updates.map((item) => item.oracleId)
      ),
      tx.pure.vector(
        'u256',
        options.updates.map((item) => item.value)
      )
    ]
  })

  return tx
}

export async function updateTokenPriceBatchPTB(options: OraclePriceBatchOptions) {
  const config = await resolveAdminConfig(options)

  return updateTokenPriceBatchRawPTB({
    ...options,
    config,
    updates: options.updates.map((update) => {
      const feed = resolveOracleFeedByOracleId(config, update.oracleId)
      return {
        oracleId: update.oracleId,
        value: encodePriceInput(update.value, feed.priceDecimal)
      }
    })
  })
}

export async function createPriceFeedRawPTB(
  options: AdminPTBOptions & {
    coinType: string
    oracleId: number
    maxTimestampDiff: string
    priceDiffThreshold1: string
    priceDiffThreshold2: string
    maxDurationWithinThresholds: string
    maximumAllowedSpanPercentage: string
    maximumEffectivePrice: string
    minimumEffectivePrice: string
    historicalPriceTTL: string
  }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: oracleTarget(config, 'oracle_manage', 'create_price_feed'),
    typeArguments: [options.coinType],
    arguments: [
      tx.object(config.oracle.oracleAdminCap),
      tx.object(config.oracle.oracleConfig),
      tx.pure.u8(options.oracleId),
      tx.pure.u64(options.maxTimestampDiff),
      tx.pure.u64(options.priceDiffThreshold1),
      tx.pure.u64(options.priceDiffThreshold2),
      tx.pure.u64(options.maxDurationWithinThresholds),
      tx.pure.u64(options.maximumAllowedSpanPercentage),
      tx.pure.u256(options.maximumEffectivePrice),
      tx.pure.u256(options.minimumEffectivePrice),
      tx.pure.u64(options.historicalPriceTTL)
    ]
  })

  return tx
}

export async function createPriceFeedPTB(
  options: AdminPTBOptions & {
    coinType: string
    oracleId: number
    maxTimestampDiff: string
    priceDiffThreshold1: string
    priceDiffThreshold2: string
    maxDurationWithinThresholds: string
    maximumAllowedSpanPercentage: string
    maximumEffectivePrice: PriceInput
    minimumEffectivePrice: PriceInput
    historicalPriceTTL: string
  }
) {
  return createPriceFeedRawPTB({
    ...options,
    maximumEffectivePrice: encodePriceInput(options.maximumEffectivePrice),
    minimumEffectivePrice: encodePriceInput(options.minimumEffectivePrice)
  })
}

export const setEnableToPriceFeedPTB = makeBooleanOracleConfigSetter('set_enable_to_price_feed')
export async function setMaximumEffectivePriceToPriceFeedRawPTB(
  options: OracleFeedPriceRawOptions
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: oracleTarget(config, 'oracle_manage', 'set_maximum_effective_price_to_price_feed'),
    arguments: [
      tx.object(config.oracle.oracleAdminCap),
      tx.object(config.oracle.oracleConfig),
      tx.pure.address(options.feedId),
      tx.pure.u256(options.value)
    ]
  })

  return tx
}

export async function setMaximumEffectivePriceToPriceFeedPTB(options: OracleFeedPriceOptions) {
  const config = await resolveAdminConfig(options)
  const feed = resolveOracleFeedByFeedId(config, options.feedId)

  return setMaximumEffectivePriceToPriceFeedRawPTB({
    ...options,
    config,
    value: encodePriceInput(options.value, feed.priceDecimal)
  })
}

export async function setMinimumEffectivePriceToPriceFeedRawPTB(
  options: OracleFeedPriceRawOptions
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: oracleTarget(config, 'oracle_manage', 'set_minimum_effective_price_to_price_feed'),
    arguments: [
      tx.object(config.oracle.oracleAdminCap),
      tx.object(config.oracle.oracleConfig),
      tx.pure.address(options.feedId),
      tx.pure.u256(options.value)
    ]
  })

  return tx
}

export async function setMinimumEffectivePriceToPriceFeedPTB(options: OracleFeedPriceOptions) {
  const config = await resolveAdminConfig(options)
  const feed = resolveOracleFeedByFeedId(config, options.feedId)

  return setMinimumEffectivePriceToPriceFeedRawPTB({
    ...options,
    config,
    value: encodePriceInput(options.value, feed.priceDecimal)
  })
}

export const setMaxTimestampDiffToPriceFeedPTB = makeU64OracleConfigSetter(
  'set_max_timestamp_diff_to_price_feed'
)
export const setPriceDiffThreshold1ToPriceFeedPTB = makeU64OracleConfigSetter(
  'set_price_diff_threshold1_to_price_feed'
)
export const setPriceDiffThreshold2ToPriceFeedPTB = makeU64OracleConfigSetter(
  'set_price_diff_threshold2_to_price_feed'
)
export const setMaxDurationWithinThresholdsToPriceFeedPTB = makeU64OracleConfigSetter(
  'set_max_duration_within_thresholds_to_price_feed'
)
export const setMaximumAllowedSpanPercentageToPriceFeedPTB = makeU64OracleConfigSetter(
  'set_maximum_allowed_span_percentage_to_price_feed'
)
export const setHistoricalPriceTTLToPriceFeedPTB = makeU64OracleConfigSetter(
  'set_historical_price_ttl_to_price_feed'
)
export const setPythPriceOracleProviderPairIdPTB = makeVectorOracleConfigSetter(
  'set_pyth_price_oracle_provider_pair_id'
)
export const enablePythOracleProviderPTB = makeOracleProviderToggle('enable_pyth_oracle_provider')
export const disablePythOracleProviderPTB = makeOracleProviderToggle('disable_pyth_oracle_provider')

export async function createPythOracleProviderConfigPTB(
  options: AdminPTBOptions & {
    feedId: string
    pairId: Uint8Array | number[]
    enable: boolean
  }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: oracleTarget(config, 'oracle_manage', 'create_pyth_oracle_provider_config'),
    arguments: [
      tx.object(config.oracle.oracleAdminCap),
      tx.object(config.oracle.oracleConfig),
      tx.pure.address(options.feedId),
      tx.pure.vector('u8', toByteVector(options.pairId)),
      tx.pure.bool(options.enable)
    ]
  })

  return tx
}

export const setSupraPriceSourcePairIdPTB = makeVectorOracleConfigSetter(
  'set_supra_price_source_pair_id'
)
export const enableSupraOracleProviderPTB = makeOracleProviderToggle('enable_supra_oracle_provider')
export const disableSupraOracleProviderPTB = makeOracleProviderToggle(
  'disable_supra_oracle_provider'
)

export async function createSupraOracleProviderConfigPTB(
  options: AdminPTBOptions & {
    feedId: string
    pairId: number
    enable: boolean
  }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: oracleTarget(config, 'oracle_manage', 'create_supra_oracle_provider_config'),
    arguments: [
      tx.object(config.oracle.oracleAdminCap),
      tx.object(config.oracle.oracleConfig),
      tx.pure.address(options.feedId),
      tx.pure.u32(options.pairId),
      tx.pure.bool(options.enable)
    ]
  })

  return tx
}

export async function createSwitchboardOracleProviderConfigPTB(
  options: AdminPTBOptions & {
    feedId: string
    pairId: Uint8Array | number[]
    enable: boolean
  }
) {
  const { tx, config } = await resolveAdminPTBContext(options)

  tx.moveCall({
    target: oracleTarget(config, 'oracle_manage', 'create_switchboard_oracle_provider_config'),
    arguments: [
      tx.object(config.oracle.oracleAdminCap),
      tx.object(config.oracle.oracleConfig),
      tx.pure.address(options.feedId),
      tx.pure.vector('u8', toByteVector(options.pairId)),
      tx.pure.bool(options.enable)
    ]
  })

  return tx
}

export const setSwitchboardPriceSourcePairIdPTB = makeVectorOracleConfigSetter(
  'set_switchboard_price_source_pair_id'
)
export const enableSwitchboardOracleProviderPTB = makeOracleProviderToggle(
  'enable_switchboard_oracle_provider'
)
export const disableSwitchboardOracleProviderPTB = makeOracleProviderToggle(
  'disable_switchboard_oracle_provider'
)

export async function setPrimaryOracleProviderPTB(
  options: AdminPTBOptions & {
    feedId: string
    provider: OracleProviderKind
  }
) {
  const { tx, config, providerRef } = await buildOracleProvider(options, options.provider)

  tx.moveCall({
    target: oracleTarget(config, 'oracle_manage', 'set_primary_oracle_provider'),
    arguments: [
      tx.object(config.oracle.oracleAdminCap),
      tx.object(config.oracle.oracleConfig),
      tx.pure.address(options.feedId),
      providerRef
    ]
  })

  return tx
}

export async function setSecondaryOracleProviderPTB(
  options: AdminPTBOptions & {
    feedId: string
    provider: OracleProviderKind
  }
) {
  const { tx, config, providerRef } = await buildOracleProvider(options, options.provider)

  tx.moveCall({
    target: oracleTarget(config, 'oracle_manage', 'set_secondary_oracle_provider'),
    arguments: [
      tx.object(config.oracle.oracleAdminCap),
      tx.object(config.oracle.oracleConfig),
      tx.pure.address(options.feedId),
      providerRef
    ]
  })

  return tx
}
