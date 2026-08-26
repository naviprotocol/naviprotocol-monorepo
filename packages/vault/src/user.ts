import {
    CacheOption,
    EnvOption,
    VaultPosition,
    VaultProtocol,
    VaultIdentifier,
    PendingRequest
} from './types'
import { fetchVaultApiData, withCache, withSingleton, queryString, parseHumanAmount } from './utils'
import { OPEN_API_URL } from './config'
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
    /**
     * Minimum shares the deposit must mint, enforced on-chain by Volo's
     * `user_entry::deposit`. NAVI vault deposits have no slippage parameter —
     * passing a non-zero floor for a NAVI vault throws instead of silently
     * dropping the protection.
     */
    expectedShares?: bigint
}

export type WithdrawPTBOptions = {
    client?: SuiGrpcClient
}

/**
 * What to withdraw:
 * - `amount` — human-readable decimal string in vault coin units ("1.5"), like `depositPTB`.
 * - `shares` — raw on-chain share count (the unit `VaultPosition.shares` is in).
 * - `all` — everything the owner's receipts hold.
 */
export type WithdrawTarget =
    | { kind: 'amount'; amount: string }
    | { kind: 'shares'; shares: string | bigint }
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
    }),
    { defaultCacheTime: 1000 }
)

/**
 * Builds a deposit into the vault.
 *
 * @param amount - Human-readable decimal string in vault coin units ("1.5", "0.0002").
 *                 Raw base-unit flows live on the protocol-level builders
 *                 (`navi.depositPTB` / `volo.depositPTB`).
 */
export async function depositPTB(
    tx: Transaction,
    vaultIdentifier: VaultIdentifier,
    owner: string,
    amount: string,
    options?: DepositPTBOptions
): Promise<TransactionResult> {
    const vault = await getVault(vaultIdentifier)
    const amountRaw = parseHumanAmount(amount, vault.assets.baseCoin.decimals)
    switch (vault.source) {
        case 'navi':
            return await navi.depositPTB(tx, vault, owner, amountRaw, options)
        case 'volo':
            return await volo.depositPTB(tx, vault, owner, amountRaw, options)
        default:
            throw vaultErrors.vaultUnsupported(vault.id, 'depositPTB', vault.source)
    }
}

/**
 * Builds a withdrawal from the vault.
 *
 * Returns what the protocol produces: for NAVI vaults the withdrawn coin
 * (`TransactionResult`), for Volo vaults the created request ids
 * (`TransactionResult[]`) — Volo withdrawals settle asynchronously once an
 * operator executes the request.
 */
export async function withdrawPTB(
    tx: Transaction,
    vaultIdentifier: VaultIdentifier,
    owner: string,
    target: WithdrawTarget,
    options?: WithdrawPTBOptions
): Promise<TransactionResult | TransactionResult[]> {
    const vault = await getVault(vaultIdentifier)

    let normalized:
        | { kind: 'amount'; amount: bigint }
        | { kind: 'shares'; shares: bigint }
        | { kind: 'all' }
    try {
        if (target.kind === 'all') {
            normalized = { kind: 'all' }
        } else if (target.kind === 'shares') {
            const shares = BigInt(target.shares)
            if (shares <= 0n) {
                throw vaultErrors.invalidAmount('withdraw shares must be greater than zero', {
                    shares: shares.toString()
                })
            }
            normalized = { kind: 'shares', shares }
        } else {
            normalized = {
                kind: 'amount',
                amount: parseHumanAmount(target.amount, vault.assets.baseCoin.decimals)
            }
        }
    } catch (error) {
        if (isVaultSdkError(error)) throw error
        throw vaultErrors.invalidAmount('withdraw target contains an invalid value', {
            target,
            cause: error instanceof Error ? error.message : String(error)
        })
    }

    switch (vault.source) {
        case 'navi':
            return await navi.withdrawPTB(tx, vault, owner, normalized, options)
        case 'volo':
            return await volo.withdrawPTB(tx, vault, owner, normalized, options)
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

async function cancelPendingRequestPTB(
    tx: Transaction,
    request: PendingRequest,
    expectedType: 'deposit' | 'withdraw'
) {
    if (request.type !== expectedType) {
        throw vaultErrors.invalidRequestType(expectedType, request.type)
    }
    const vault = await getVault(request.vaultId)
    if (!vault.volo) {
        throw vaultErrors.vaultConfigInvalid(vault.id, 'missing Volo package configuration')
    }
    return tx.moveCall({
        target: `${vault.volo.package}::user_entry::cancel_${expectedType}`,
        typeArguments: [vault.assets.baseCoin.coinType],
        arguments: [
            tx.object(request.vaultId),
            tx.object(request.receiptId),
            tx.pure.u64(request.requestId),
            tx.object('0x6')
        ]
    })
}

/**
 * Cancels a pending Volo deposit request. Returns the refunded principal coin —
 * the caller must consume it (e.g. transfer it back to the owner).
 */
export async function cancelPendingDepositPTB(tx: Transaction, request: PendingRequest) {
    return await cancelPendingRequestPTB(tx, request, 'deposit')
}

/** Cancels a pending Volo withdraw request. Returns the cancelled share count (u256). */
export async function cancelPendingWithdrawPTB(tx: Transaction, request: PendingRequest) {
    return await cancelPendingRequestPTB(tx, request, 'withdraw')
}
