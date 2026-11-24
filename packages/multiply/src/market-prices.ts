import type {
  LendingConfig,
  MarketSnapshot,
  NaviEnv,
  OraclePriceFreshness,
  Strategy
} from './types'
import { BN, address, sameCoin } from './utils'

export const MARKET_PRICE_MAX_AGE_MS = 30_000
export const MARKET_PRICE_MARGIN_MS = 2_000
/** Bind evidence to the actual oracle/calculator deployment, not to the response host or time. */
export function oracleDeploymentRevision(
  env: NaviEnv,
  market: string,
  config: Pick<LendingConfig, 'package' | 'priceOracle' | 'oracle'>
) {
  return JSON.stringify([
    env,
    market,
    address(config.package),
    address(config.priceOracle),
    address(config.oracle.packageId)
  ])
}

export function marketOraclePrices(
  strategy: Strategy,
  config: LendingConfig,
  env: NaviEnv,
  collateral: MarketSnapshot['collateral'],
  debt: MarketSnapshot['debt'],
  now = Date.now()
): Pick<MarketSnapshot, 'collateralPrice' | 'debtPrice' | 'priceEvidence'> | undefined {
  try {
    const revision = oracleDeploymentRevision(env, strategy.market, config)
    const rows = [collateral, debt].map((pool, i) => {
      const coin = i === 0 ? strategy.collateralCoinType : strategy.debtCoinType
      const oracle = pool.oracle as typeof pool.oracle & { freshness?: OraclePriceFreshness }
      const f = oracle?.freshness
      const feeds = config.oracle.feeds.filter(
        (feed) =>
          sameCoin(feed.coinType, coin) &&
          (feed as { ratioOracleId?: number | null }).ratioOracleId == null
      )
      if (
        !sameCoin(pool.suiCoinType, coin) ||
        pool.market !== strategy.market ||
        oracle?.valid !== true ||
        oracle.oracleId !== pool.oracleId ||
        feeds.length !== 1 ||
        feeds[0].oracleId !== oracle.oracleId ||
        !f ||
        f.version !== 1 ||
        f.source !== 'navi-oracle' ||
        f.deploymentRevision !== revision ||
        typeof f.snapshotId !== 'string' ||
        !/^[a-f0-9]{64}$/.test(f.snapshotId) ||
        ![f.observedAtMs, f.chainObservedAtMs, f.validUntilMs].every(
          (v) => Number.isSafeInteger(v) && v > 0
        ) ||
        f.observedAtMs > now ||
        Math.abs(f.chainObservedAtMs - f.observedAtMs) > 2000 ||
        f.validUntilMs <= f.chainObservedAtMs ||
        typeof oracle.price !== 'string' ||
        !/^\d+(\.\d+)?$/.test(oracle.price) ||
        !new BN(oracle.price).isFinite() ||
        !new BN(oracle.price).gt(0) ||
        typeof oracle.value !== 'string' ||
        !/^(0|[1-9][0-9]*)$/.test(oracle.value) ||
        !Number.isInteger(oracle.decimal) ||
        oracle.decimal < 0 ||
        oracle.decimal > 18 ||
        !new BN(oracle.value).shiftedBy(-oracle.decimal).eq(oracle.price)
      )
        return undefined
      // The known calculator evaluates an amount of 1e18 using integer arithmetic.
      const price = new BN(oracle.value)
        .times('1e18')
        .div(new BN(10).pow(oracle.decimal))
        .integerValue(BN.ROUND_DOWN)
        .div('1e18')
        .toFixed()
      const expiresAt =
        Math.min(f.observedAtMs + MARKET_PRICE_MAX_AGE_MS, f.validUntilMs) - MARKET_PRICE_MARGIN_MS
      return now < expiresAt ? { f, price, expiresAt } : undefined
    })
    const [c, d] = rows
    if (
      !c ||
      !d ||
      c.f.snapshotId !== d.f.snapshotId ||
      c.f.observedAtMs !== d.f.observedAtMs ||
      c.f.chainObservedAtMs !== d.f.chainObservedAtMs
    )
      return undefined
    return {
      collateralPrice: c.price,
      debtPrice: d.price,
      priceEvidence: {
        source: 'market',
        snapshotId: c.f.snapshotId,
        observedAtMs: c.f.observedAtMs,
        expiresAt: Math.min(c.expiresAt, d.expiresAt)
      }
    }
  } catch {
    return undefined
  }
}
