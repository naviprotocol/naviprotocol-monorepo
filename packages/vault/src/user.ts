import {
  CacheOption,
  EnvOption,
  VaultPosition,
  VaultProtocol,
  VaultIdentifier,
  PendingRequest
} from './types'
import { withCache, withSingleton, queryString } from './utils'
import { OPEN_API_URL, U64_MAX } from './config'
import type {
  Transaction,
  TransactionObjectArgument,
  TransactionResult
} from '@mysten/sui/transactions'
import { getVault } from './vault'
import * as navi from './protocols/navi'
import * as volo from './protocols/volo'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { DEFAULT_CACHE_TIME } from '@naviprotocol/lending'

export type GetPositionsOptions = Partial<
  {
    protocols: VaultProtocol[]
    vaults: string[]
  } & EnvOption &
    CacheOption
>

export type GetVaultPositionOptions = Partial<EnvOption & CacheOption>

export type DepositPTBOptions = {
  coin?: TransactionObjectArgument
  useGasCoin?: boolean
  client?: SuiGrpcClient
}

export type WithdrawPTBOptions = {
  client?: SuiGrpcClient
}

export type WithdrawTarget =
  | { kind: 'amount'; amount: string }
  | { kind: 'shares'; shares: string }
  | { kind: 'all' }

export const getPositions = withCache(
  withSingleton(async (owner: string, options?: GetPositionsOptions): Promise<VaultPosition[]> => {
    const url = `${OPEN_API_URL}/vaults/positions?${queryString({
      address: owner
    })}`

    const res: {
      data: VaultPosition[]
    } = await fetch(url, { headers: {} }).then((res) => res.json())

    let positions = res.data

    if (options?.protocols) {
      positions = positions.filter((position) => {
        return options.protocols?.includes(position.protocol)
      })
    }

    if (options?.vaults) {
      positions = positions.filter((position) => {
        return options.vaults?.includes(position.vaultId)
      })
    }

    return positions
  })
)

export async function depositPTB(
  tx: Transaction,
  vaultIdentifier: VaultIdentifier,
  owner: string,
  amount: number | bigint,
  options?: DepositPTBOptions
): Promise<TransactionResult> {
  const vault = await getVault(vaultIdentifier)
  const amountWithDecimals = BigInt(amount) * BigInt(Math.pow(10, vault.assets.baseCoin.decimals))
  switch (vault.source) {
    case 'navi':
      return await navi.depositPTB(tx, vault, owner, amountWithDecimals, options)
    case 'volo':
      return await volo.depositPTB(tx, vault, owner, amountWithDecimals, options)
    default:
      throw new Error(`vault ${vault.source} not support`)
  }
}

export async function withdrawPTB(
  tx: Transaction,
  vaultIdentifier: VaultIdentifier,
  owner: string,
  target: WithdrawTarget,
  options?: WithdrawPTBOptions
) {
  const vault = await getVault(vaultIdentifier)
  let shares = 0n
  if (target.kind === 'all') {
    shares = U64_MAX
  } else if (target.kind === 'shares') {
    shares = BigInt(target.shares)
  } else {
    shares =
      (BigInt(target.amount) * BigInt(vault.totalShares || 0n)) / BigInt(vault.totalStaked || 0n)
  }
  switch (vault.source) {
    case 'navi':
      return await navi.withdrawPTB(tx, vault, owner, shares, options)
    case 'volo':
      return await volo.withdrawPTB(tx, vault, owner, shares, options)
    default:
      throw new Error(`vault ${vault.source} not support`)
  }
}

export async function getVaultRewards(
  vaultIdentifier: VaultIdentifier,
  owner: string,
  options?: {
    client: SuiGrpcClient
  }
) {
  const vault = await getVault(vaultIdentifier)
  if (vault.source === 'navi') {
    return await navi.getVaultRewards(vault, owner, options)
  }
  return []
}

export async function claimRewardsPTB(
  tx: Transaction,
  rewards: navi.VaultReward[],
  options?: {
    client: SuiGrpcClient
  }
) {
  return await navi.claimRewardsPTB(tx, rewards, options)
}

export async function getPendingRequests(
  owner: string,
  options?: {
    vault?: string
  }
): Promise<PendingRequest[]> {
  const url = `${OPEN_API_URL}/vaults/requests?${queryString({
    address: owner,
    vault: options?.vault
  })}`

  const res: {
    data: PendingRequest[]
  } = await fetch(url, { headers: {} }).then((res) => res.json())

  return res.data
}

export async function canclePendingDepositPTB(tx: Transaction, request: PendingRequest) {
  const vault = await getVault(request.vaultId, {
    cacheTime: DEFAULT_CACHE_TIME
  })
  if (request.type !== 'deposit') {
    throw new Error('request type must be deposit')
  }
  return tx.moveCall({
    target: `${vault!.volo!.package}::user_entry::cancel_deposit`,
    typeArguments: [vault.assets.baseCoin.coinType],
    arguments: [
      tx.object(request.vaultId),
      tx.object(request.receiptId),
      tx.pure.u64(request.requestId),
      tx.object('0x06')
    ]
  })
}

export async function canclePendingWithdrawPTB(tx: Transaction, request: PendingRequest) {
  const vault = await getVault(request.vaultId, {
    cacheTime: DEFAULT_CACHE_TIME
  })
  if (request.type !== 'withdraw') {
    throw new Error('request type must be withdraw')
  }
  tx.moveCall({
    target: `${vault!.volo!.package}::user_entry::cancel_withdraw`,
    typeArguments: [vault.assets.baseCoin.coinType],
    arguments: [
      tx.object(request.vaultId),
      tx.object(request.receiptId),
      tx.pure.u64(request.requestId),
      tx.object('0x06')
    ]
  })
}
