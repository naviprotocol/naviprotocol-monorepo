import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import type {
  ConversionQuote,
  ConversionRequest,
  MultiplySuiClient,
  RedemptionSnapshot
} from './types'
import { address, check, coinType, inspect, recordReadVersion, sameCoin, uint } from './utils'

const record = (value: unknown): Record<string, unknown> => {
  check(
    value && typeof value === 'object' && !Array.isArray(value),
    'READ_FAILED',
    'Missing redemption state'
  )
  return value as Record<string, unknown>
}
const number = (value: unknown) => {
  check(typeof value === 'string', 'READ_FAILED', 'Invalid redemption integer')
  return uint(value)
}

/** Mirrors the pinned native redemption functions; never used as a NAVI risk price. */
export function quoteRedemptionSnapshot(
  s: RedemptionSnapshot,
  req: ConversionRequest
): ConversionQuote {
  check(
    sameCoin(req.coinIn, s.coinIn) && sameCoin(req.coinOut, s.coinOut),
    'INVALID_CONVERSION',
    'Redemption pair mismatch'
  )
  check(
    s.expiresAt > Date.now() && Number.isSafeInteger(s.expiresAt),
    'SNAPSHOT_UNAVAILABLE',
    'Redemption snapshot expired'
  )
  check(
    Number.isInteger(req.slippageBps) && req.slippageBps >= 0 && req.slippageBps < 10000,
    'INVALID_ARGUMENT',
    'Invalid slippage'
  )
  const input = uint(req.amountIn, false),
    sui = uint(s.suiSupply, false),
    lst = uint(s.lstSupply, false)
  const rate = uint(s.feeRate),
    denominator = uint(s.feeDenominator, false)
  check(
    rate < denominator && ['ceil', 'floor'].includes(s.feeRounding),
    'READ_FAILED',
    'Invalid redemption fee'
  )
  check(input <= lst, 'CONVERTER_UNAVAILABLE', 'Redemption exceeds LST supply')
  if (s.converterId === 'volo')
    check(input >= 100_000_000n, 'CONVERSION_AMOUNT_TOO_SMALL', 'Volo minimum LST input')
  const gross = uint(((input * sui) / lst).toString(), false)
  // Volo quick path deliberately uses available cash only. Validator unstaking
  // may return up to ten fewer atoms; those routes must use the original solver/build.
  check(
    gross <= uint(s.availableSui),
    'CONVERTER_UNAVAILABLE',
    'Native redemption cash is insufficient'
  )
  const fee = (gross * rate + (s.feeRounding === 'ceil' ? denominator - 1n : 0n)) / denominator
  const net = gross - fee
  check(
    ['gross', 'net'].includes(s.minOutputBasis),
    'READ_FAILED',
    'Invalid redemption minimum basis'
  )
  check(
    (s.minOutputBasis === 'gross' ? gross : net) >= uint(s.minOutput, false),
    'CONVERSION_AMOUNT_TOO_SMALL',
    'Native redemption below minimum'
  )
  const min = (net * BigInt(10000 - req.slippageBps)) / 10000n
  check(min > 0n, 'CONVERSION_AMOUNT_TOO_SMALL', 'Redemption rounds to zero')
  return {
    converterId: s.converterId,
    input: { coinType: coinType(req.coinIn), amount: req.amountIn },
    expectedOutput: { coinType: coinType(req.coinOut), amount: net.toString() },
    minOutput: { coinType: coinType(req.coinOut), amount: min.toString() },
    expiresAt: Date.now() + 120_000,
    data: { version: 1, stake: false, feeRate: s.feeRate, feeDenominator: s.feeDenominator },
    fees: [
      {
        provider: s.converterId,
        coinType: coinType(req.coinOut),
        amount: fee.toString(),
        feeKind: 'redemption',
        includedInExpectedOutput: true
      }
    ]
  }
}

export function createRedemptionSnapshotReader(
  client: MultiplySuiClient,
  config: {
    converterId: 'volo' | 'haedal'
    packageId: string
    pool: string
    metadata?: string
    coinIn: string
    coinOut: string
  }
) {
  // Request-local converter instance. No cross-wallet reservation or shared cash cache.
  return async (
    pair: Pick<ConversionRequest, 'coinIn' | 'coinOut'>
  ): Promise<RedemptionSnapshot | undefined> => {
    if (!sameCoin(pair.coinIn, config.coinIn) || !sameCoin(pair.coinOut, config.coinOut))
      return undefined
    const started = Date.now()
    const [{ systemState }, { object }] = await Promise.all([
      client.core.getCurrentSystemState(),
      client.core.getObject({ objectId: config.pool, include: { json: true } })
    ])
    let epoch = uint(systemState.epoch).toString()
    const state = record(object?.json),
      versions: Record<string, string> = {}
    let suiSupply: string, lstSupply: string, feeRate: string, availableSui: string
    if (config.converterId === 'volo') {
      const manage = record(state.manage)
      check(
        manage.version === '2' && typeof manage.paused === 'boolean',
        'READ_FAILED',
        'Unsupported Volo redemption state'
      )
      check(!manage.paused, 'CONVERTER_UNAVAILABLE', 'Volo is paused')
      // Below the SDK's minimum, no cash-only candidate can possibly qualify.
      // Stop before refresh/getter simulation; normal converter fallback is unchanged.
      const cashBefore = number(record(state.validator_pool).sui_pool)
      check(
        cashBefore >= 1000000000n,
        'CONVERTER_UNAVAILABLE',
        'Volo cash below redemption minimum'
      )
      const tx = new Transaction(),
        call = (module: string, fn: string, args: TransactionObjectArgument[]) =>
          tx.moveCall({ target: `${config.packageId}::${module}::${fn}`, arguments: args })
      call('stake_pool', 'refresh', [
        tx.object(config.pool),
        tx.object(config.metadata!),
        tx.object('0x5')
      ])
      call('stake_pool', 'total_sui_supply', [tx.object(config.pool)])
      call('stake_pool', 'total_lst_supply', [tx.object(config.metadata!)])
      const fee = call('stake_pool', 'fee_config', [tx.object(config.pool)])
      call('fee_config', 'unstake_fee_bps', [fee])
      const pool = call('stake_pool', 'validator_pool', [tx.object(config.pool)])
      const cash = call('validator_pool', 'sui_pool', [pool])
      tx.moveCall({
        target: '0x2::balance::value',
        typeArguments: ['0x2::sui::SUI'],
        arguments: [cash]
      })
      tx.moveCall({ target: '0x2::tx_context::epoch', arguments: [] })
      const r = await inspect(client, tx, versions)
      check(
        versions[address(config.pool)] && versions[address(config.metadata!)],
        'SNAPSHOT_UNAVAILABLE',
        'Missing redemption input versions'
      )
      const u = (i: number) => uint(bcs.u64().parse(r[i].returnValues[0].bcs)).toString()
      suiSupply = u(1)
      lstSupply = u(2)
      feeRate = u(4)
      availableSui = u(7)
      epoch = u(8)
      check(BigInt(feeRate) <= 500n, 'READ_FAILED', 'Invalid Volo redemption fee')
    } else {
      recordReadVersion(versions, object.objectId, object.version)
      check(
        number(state.version) <= 5n && typeof state.pause_unstake === 'boolean',
        'READ_FAILED',
        'Unsupported Haedal redemption state'
      )
      check(!state.pause_unstake, 'CONVERTER_UNAVAILABLE', 'Haedal redemption is paused')
      let total = number(state.total_staked) + number(state.total_rewards)
      uint(total.toString())
      for (const key of ['total_protocol_fees', 'uncollected_protocol_fees', 'total_unstaked']) {
        total -= number(state[key])
        uint(total.toString())
      }
      suiSupply = total.toString()
      lstSupply = number(state.stsui_supply).toString()
      feeRate = number(record(state.config).service_fee).toString()
      availableSui = number(record(state.sui_vault).cache_pool).toString()
    }
    const latest = await client.core.getCurrentSystemState()
    check(
      uint(latest.systemState.epoch).toString() === epoch && started + 5000 > Date.now(),
      'SNAPSHOT_UNAVAILABLE',
      'Redemption snapshot expired or epoch changed'
    )
    check(
      BigInt(suiSupply) > 0n && BigInt(lstSupply) > 0n,
      'SNAPSHOT_UNAVAILABLE',
      'Empty redemption pool'
    )
    return {
      converterId: config.converterId,
      coinIn: coinType(config.coinIn),
      coinOut: coinType(config.coinOut),
      suiSupply,
      lstSupply,
      feeRate,
      availableSui,
      feeDenominator: config.converterId === 'volo' ? '10000' : '10000000',
      feeRounding: config.converterId === 'volo' ? 'ceil' : 'floor',
      minOutput: '1000000000',
      minOutputBasis: config.converterId === 'volo' ? 'net' : 'gross',
      source: { packageId: config.packageId, objectVersions: versions },
      epoch,
      observedAt: started,
      expiresAt: started + 5000
    }
  }
}
