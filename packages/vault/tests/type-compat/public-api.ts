import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'
import {
  cancelPendingDepositPTB,
  cancelPendingWithdrawPTB,
  claimRewardsPTB,
  depositPTB,
  getPendingRequests,
  getPositions,
  getVault,
  getVaultRewards,
  getVaults,
  isVaultSdkError,
  navi,
  VAULT_SDK_ERROR_CODES,
  VaultSdkError,
  vaultErrors,
  volo,
  withdrawPTB
} from '@naviprotocol/vault'
import type { PendingRequest, Vault, VaultPosition } from '@naviprotocol/vault'
import type { VaultSdkErrorCode } from '@naviprotocol/vault'

/** Compile-only coverage for the package's public entry point. */
export async function publicApiCompiles(
  client: SuiGrpcClient,
  vault: Vault,
  owner: string,
  request: PendingRequest
): Promise<void> {
  const tx = new Transaction()
  const errorCode: VaultSdkErrorCode = VAULT_SDK_ERROR_CODES.INVALID_AMOUNT
  const sdkError: VaultSdkError = vaultErrors.invalidAmount('type compatibility check')
  const recognized: boolean = isVaultSdkError(sdkError)

  const allVaults: Vault[] = await getVaults({ protocols: ['navi', 'volo'] })
  const resolved: Vault = await getVault(vault)
  const positions: VaultPosition[] = await getPositions(owner, { vaults: [resolved.id] })
  const requests: PendingRequest[] = await getPendingRequests(owner, { vault: resolved.id })

  await depositPTB(tx, resolved, owner, '1.5', { client, useGasCoin: true, expectedShares: 1n })
  await withdrawPTB(tx, resolved, owner, { kind: 'shares', shares: '1' }, { client })
  await withdrawPTB(tx, resolved, owner, { kind: 'amount', amount: '0.5' }, { client })
  await withdrawPTB(tx, resolved, owner, { kind: 'all' }, { client })
  await cancelPendingDepositPTB(tx, request)
  await cancelPendingWithdrawPTB(tx, request)

  const rewards = await getVaultRewards(resolved, owner, { client })
  await claimRewardsPTB(tx, rewards, { client })

  if (resolved.source === 'navi') {
    await navi.getVaultInfo(resolved, { client })
    await navi.getVaultReceipts(resolved, owner, { client })
  } else {
    await volo.getVaultReceipts(resolved, owner, { client })
    await volo.getPendingRequests(resolved, owner, { client })
  }

  void allVaults
  void errorCode
  void sdkError
  void recognized
  void positions
  void requests
  void request
}
