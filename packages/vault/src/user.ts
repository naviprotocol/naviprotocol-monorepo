import {
  CacheOption,
  EnvOption,
  VaultPosition,
  VaultProtocol,
  VaultIdentifier,
  PendingRequest
} from './types'
import { fetchVaultApiData, withCache, withSingleton, queryString } from './utils'
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
import { isVaultSdkError, vaultErrors } from './error'

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

    const data = await fetchVaultApiData<VaultPosition[]>(url)
    if (!Array.isArray(data)) {
      throw vaultErrors.apiResponseInvalid(url, 'data is not an array')
    }
    let positions = data

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
  let amountWithDecimals: bigint
  try {
    amountWithDecimals = BigInt(amount) * 10n ** BigInt(vault.assets.baseCoin.decimals)
  } catch (error) {
    throw vaultErrors.invalidAmount('amount must be an integer number or bigint', {
      amount: String(amount),
      cause: error instanceof Error ? error.message : String(error)
    })
  }
  if (amountWithDecimals < 0n) {
    throw vaultErrors.invalidAmount('amount must not be negative', { amount: String(amount) })
  }
  switch (vault.source) {
    case 'navi':
      return await navi.depositPTB(tx, vault, owner, amountWithDecimals, options)
    case 'volo':
      return await volo.depositPTB(tx, vault, owner, amountWithDecimals, options)
    default:
      throw vaultErrors.vaultUnsupported(vault.id, 'depositPTB', vault.source)
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
  try {
    if (target.kind === 'all') {
      shares = U64_MAX
    } else if (target.kind === 'shares') {
      shares = BigInt(target.shares)
    } else {
      const totalShares = BigInt(vault.totalShares || 0n)
      const totalStaked = BigInt(vault.totalStaked || 0n)
      if (totalStaked === 0n) {
        throw vaultErrors.vaultConfigInvalid(vault.id, 'totalStaked must be greater than zero')
      }
      shares = (BigInt(target.amount) * totalShares) / totalStaked
    }
  } catch (error) {
    if (isVaultSdkError(error)) throw error
    throw vaultErrors.invalidAmount('withdraw target contains a non-integer value', {
      target,
      cause: error instanceof Error ? error.message : String(error)
    })
  }
  if (shares < 0n) {
    throw vaultErrors.invalidAmount('withdraw shares must not be negative', { target })
  }
  switch (vault.source) {
    case 'navi':
      return await navi.withdrawPTB(tx, vault, owner, shares, options)
    case 'volo':
      return await volo.withdrawPTB(tx, vault, owner, shares, options)
    default:
      throw vaultErrors.vaultUnsupported(vault.id, 'withdrawPTB', vault.source)
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

  const data = await fetchVaultApiData<PendingRequest[]>(url)
  if (!Array.isArray(data)) {
    throw vaultErrors.apiResponseInvalid(url, 'data is not an array')
  }
  return data
}

export async function canclePendingDepositPTB(tx: Transaction, request: PendingRequest) {
  if (request.type !== 'deposit') {
    throw vaultErrors.invalidRequestType('deposit', request.type)
  }
  const vault = await getVault(request.vaultId, {
    cacheTime: DEFAULT_CACHE_TIME
  })
  if (!vault.volo) {
    throw vaultErrors.vaultConfigInvalid(vault.id, 'missing Volo package configuration')
  }
  return tx.moveCall({
    target: `${vault.volo.package}::user_entry::cancel_deposit`,
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
  if (request.type !== 'withdraw') {
    throw vaultErrors.invalidRequestType('withdraw', request.type)
  }
  const vault = await getVault(request.vaultId, {
    cacheTime: DEFAULT_CACHE_TIME
  })
  if (!vault.volo) {
    throw vaultErrors.vaultConfigInvalid(vault.id, 'missing Volo package configuration')
  }
  tx.moveCall({
    target: `${vault.volo.package}::user_entry::cancel_withdraw`,
    typeArguments: [vault.assets.baseCoin.coinType],
    arguments: [
      tx.object(request.vaultId),
      tx.object(request.receiptId),
      tx.pure.u64(request.requestId),
      tx.object('0x06')
    ]
  })
}
