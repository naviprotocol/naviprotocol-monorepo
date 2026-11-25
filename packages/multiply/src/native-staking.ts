import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import type {
  ConversionQuote,
  ConversionRequest,
  MultiplySuiClient,
  StakingSnapshot
} from './types'
import { check, coinType, inspect, MultiplyError, sameCoin, uint } from './utils'

const TTL = 5_000
function object(value: unknown, label: string): Record<string, unknown> {
  check(
    value && typeof value === 'object' && !Array.isArray(value),
    'READ_FAILED',
    `Invalid ${label}`
  )
  return value as Record<string, unknown>
}
function readUint(value: unknown): string {
  try {
    return uint(value).toString()
  } catch {
    throw new MultiplyError('READ_FAILED', 'Invalid native staking integer')
  }
}

/** Exact arithmetic for the pinned native stake functions, never used to value NAVI risk. */
export function quoteStakingSnapshot(
  snapshot: StakingSnapshot,
  req: ConversionRequest
): ConversionQuote {
  check(
    sameCoin(req.coinIn, snapshot.coinIn) && sameCoin(req.coinOut, snapshot.coinOut),
    'INVALID_CONVERSION',
    'Snapshot pair mismatch'
  )
  check(
    Number.isSafeInteger(snapshot.expiresAt) && snapshot.expiresAt > Date.now(),
    'SNAPSHOT_UNAVAILABLE',
    'Native staking snapshot expired'
  )
  check(
    Number.isInteger(req.slippageBps) && req.slippageBps >= 0 && req.slippageBps < 10000,
    'INVALID_ARGUMENT',
    'Invalid converter slippage'
  )
  const input = uint(req.amountIn, false),
    sui = uint(snapshot.suiSupply),
    lst = uint(snapshot.lstSupply)
  const feeRate = uint(snapshot.feeRate),
    denominator = uint(snapshot.feeDenominator, false)
  check(feeRate < denominator, 'READ_FAILED', 'Invalid native staking fee')
  check(
    input >= uint(snapshot.minInput, false),
    'CONVERSION_AMOUNT_TOO_SMALL',
    'Native staking input is below the SDK minimum'
  )
  check(
    snapshot.feeRounding === 'ceil' || snapshot.feeRounding === 'floor',
    'READ_FAILED',
    'Invalid fee rounding'
  )
  const fee =
    (input * feeRate + (snapshot.feeRounding === 'ceil' ? denominator - 1n : 0n)) / denominator
  const net = input - fee
  const output = sui === 0n || lst === 0n ? net : (net * lst) / sui
  uint(output.toString(), false)
  const minimum = (output * BigInt(10000 - req.slippageBps)) / 10000n
  check(minimum > 0n, 'CONVERSION_AMOUNT_TOO_SMALL', 'Native staking output rounds below one atom')
  return {
    converterId: snapshot.converterId,
    input: { coinType: coinType(req.coinIn), amount: req.amountIn },
    expectedOutput: { coinType: coinType(req.coinOut), amount: output.toString() },
    minOutput: { coinType: coinType(req.coinOut), amount: minimum.toString() },
    // Snapshot TTL controls reuse for calculation, not the existing executable quote lifetime.
    expiresAt: Date.now() + 120_000,
    data: {
      version: 1,
      stake: true,
      feeRate: snapshot.feeRate,
      feeDenominator: snapshot.feeDenominator
    },
    fees: [
      {
        coinType: coinType(req.coinIn),
        amount: fee.toString(),
        feeKind: 'deposit',
        includedInExpectedOutput: true
      }
    ]
  }
}

export function createStakingSnapshotReader(
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
  let cached: StakingSnapshot | undefined
  let pending: { epoch: string; startedAt: number; promise: Promise<StakingSnapshot> } | undefined
  let sequence = 0,
    lastSaved = 0
  const read = async (epoch: string, startedAt: number): Promise<StakingSnapshot> => {
    const { object: result } = await client.core.getObject({
      objectId: config.pool,
      include: { json: true }
    })
    const state = object(result?.json, 'native staking state')
    let suiSupply: string, lstSupply: string, feeRate: string
    if (config.converterId === 'volo') {
      const manage = object(state.manage, 'Volo management')
      check(typeof manage.paused === 'boolean', 'READ_FAILED', 'Invalid Volo pause state')
      check(!manage.paused, 'CONVERTER_UNAVAILABLE', 'Volo is paused')
      check(readUint(manage.version) === '2', 'READ_FAILED', 'Unsupported Volo state version')
      // refresh enforces version/pause again, and updates epoch-dependent rewards before
      // ALL amount getters. The entire PTB is simulated, never signed/broadcast.
      const tx = new Transaction()
      tx.moveCall({
        target: `${config.packageId}::stake_pool::refresh`,
        arguments: [tx.object(config.pool), tx.object(config.metadata!), tx.object('0x5')]
      })
      tx.moveCall({
        target: `${config.packageId}::stake_pool::total_sui_supply`,
        arguments: [tx.object(config.pool)]
      })
      tx.moveCall({
        target: `${config.packageId}::stake_pool::total_lst_supply`,
        arguments: [tx.object(config.metadata!)]
      })
      const feeConfig = tx.moveCall({
        target: `${config.packageId}::stake_pool::fee_config`,
        arguments: [tx.object(config.pool)]
      })
      tx.moveCall({
        target: `${config.packageId}::fee_config::stake_fee_bps`,
        arguments: [feeConfig]
      })
      tx.moveCall({ target: '0x2::tx_context::epoch', arguments: [] })
      const results = await inspect(client, tx)
      const value = (i: number) => readUint(bcs.u64().parse(results[i].returnValues[0].bcs))
      suiSupply = value(1)
      lstSupply = value(2)
      feeRate = value(4)
      epoch = value(5)
      check(BigInt(feeRate) <= 500n, 'READ_FAILED', 'Invalid Volo stake fee')
    } else {
      check(typeof state.pause_stake === 'boolean', 'READ_FAILED', 'Invalid Haedal pause state')
      check(!state.pause_stake, 'CONVERTER_UNAVAILABLE', 'Haedal staking is paused')
      check(
        BigInt(readUint(state.version)) <= 5n,
        'READ_FAILED',
        'Unsupported Haedal state version'
      )
      const field = (key: string) => BigInt(readUint(state[key]))
      // Pinned 0x19e6…967c get_total_sui: respect its checked-u64 operation order.
      let total = field('total_staked') + field('total_rewards')
      readUint(total.toString())
      for (const key of ['total_protocol_fees', 'uncollected_protocol_fees', 'total_unstaked']) {
        total -= field(key)
        readUint(total.toString())
      }
      suiSupply = total.toString()
      lstSupply = readUint(state.stsui_supply)
      // request_stake_coin mints on the FULL input. deposit_fee exists in storage
      // but is not read by this deployed entrypoint (verified against bytecode).
      feeRate = '0'
    }
    return {
      converterId: config.converterId,
      coinIn: coinType(config.coinIn),
      coinOut: coinType(config.coinOut),
      suiSupply,
      lstSupply,
      feeRate,
      feeDenominator: config.converterId === 'volo' ? '10000' : '10000000',
      feeRounding: config.converterId === 'volo' ? 'ceil' : 'floor',
      // Preserve the SDK's existing 1 SUI admission threshold (Volo contract itself accepts 0.1).
      minInput: '1000000000',
      epoch,
      observedAt: startedAt,
      expiresAt: startedAt + TTL
    }
  }
  return async (
    pair: Pick<ConversionRequest, 'coinIn' | 'coinOut'>
  ): Promise<StakingSnapshot | undefined> => {
    if (!sameCoin(pair.coinIn, config.coinIn) || !sameCoin(pair.coinOut, config.coinOut))
      return undefined
    // Every use checks current epoch, even during TTL. No cached pre-epoch snapshot
    // is intentionally reused after an epoch change. Build still simulates actual stake.
    const { systemState } = await client.core.getCurrentSystemState()
    const epoch = readUint(systemState.epoch)
    if (cached && cached.epoch === epoch && cached.expiresAt > Date.now()) return { ...cached }
    if (!pending || pending.epoch !== epoch || Date.now() - pending.startedAt >= TTL) {
      const startedAt = Date.now(),
        id = ++sequence
      const promise = read(epoch, startedAt)
        .then((snapshot) => {
          if (id >= lastSaved && (!cached || BigInt(snapshot.epoch) >= BigInt(cached.epoch))) {
            cached = snapshot
            lastSaved = id
          }
          return snapshot
        })
        .finally(() => {
          if (pending?.promise === promise) pending = undefined
        })
      pending = { epoch, startedAt, promise }
    }
    const snapshot = await pending.promise
    check(
      !cached || BigInt(snapshot.epoch) >= BigInt(cached.epoch),
      'SNAPSHOT_UNAVAILABLE',
      'Native snapshot was superseded by a newer epoch'
    )
    check(
      snapshot.expiresAt > Date.now(),
      'SNAPSHOT_UNAVAILABLE',
      'Native snapshot read exceeded TTL'
    )
    return { ...snapshot }
  }
}
