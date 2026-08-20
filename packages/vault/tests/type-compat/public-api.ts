import { Transaction, type TransactionResult } from '@mysten/sui/transactions'
import {
  createVaultSdk,
  type NAVILendingVault,
  type ProtocolRegistry,
  type Vault,
  type VaultReward,
  type VaultSdk,
  type VaultSuiClient,
  type VoloVault
} from '@naviprotocol/vault'

declare const client: VaultSuiClient
declare const vault: Vault

const sdk: VaultSdk = createVaultSdk(client, 'prod')
const tx = new Transaction()

const depositResult: Promise<TransactionResult> = sdk.user.depositPTB(tx, vault, '0x1', '1.25')
const filteredVaults: Promise<Vault[]> = sdk.vaults.getVaults({
  app: ['navi', 'volo']
})
const selectedVault: Promise<Vault | null> = sdk.vaults.getVault('vault-id')
declare const rewards: VaultReward[]
const claimResult: Promise<TransactionResult> = sdk.user.claimRewardsPTB(tx, vault, '0x1', rewards)
const vaultRewards: Promise<VaultReward[]> = sdk.user.getRewards(vault, '0x1')
void vaultRewards
const positions = sdk.user.getPositions('0x1', { app: ['navi', 'astros'] })

void depositResult
void filteredVaults
void selectedVault
void claimResult
void positions
void vault.id
void vault.assets.base.coinType
void vault.operatorMode
void vault.contractConfig.env
void vault.app

if (vault.protocol === 'navi-lending') {
  const lendingVault: NAVILendingVault = vault
  const defaultMarketCode: string = lendingVault.contractConfig.naviLending.defaultMarketCode
  void defaultMarketCode

  // @ts-expect-error NAVI Lending config cannot expose Volo contract fields.
  void lendingVault.contractConfig.volo
}

if (vault.protocol === 'volo-vault') {
  const voloVault: VoloVault = vault
  const vaultCode: string = voloVault.contractConfig.volo.vaultCode
  void vaultCode

  // @ts-expect-error Volo config cannot expose Lending contract fields.
  void voloVault.contractConfig.naviLending
}

declare const protocols: ProtocolRegistry

void protocols[vault.protocol]

// @ts-expect-error Legacy source is replaced by app and protocol.
void vault.source

// @ts-expect-error Display metadata is owned by the backend/frontend business model.
void vault.name

// @ts-expect-error Environment is carried only by the embedded contract config.
void vault.env

// @ts-expect-error Legacy config is replaced by contractConfig.
void vault.config

// @ts-expect-error Config is embedded in each Vault; the SDK has no config module.
void sdk.config

// @ts-expect-error User queries and PTB operations are exposed through sdk.user.
void sdk.portfolio

// @ts-expect-error There is no standalone PTB module.
void sdk.ptb

// @ts-expect-error State is not a top-level module in the public SDK.
void sdk.state

// @ts-expect-error History is not a top-level module in the public SDK.
void sdk.history

// @ts-expect-error Analytics is not a top-level module in the public SDK.
void sdk.analytics

// @ts-expect-error app is required when getVaults options are provided.
void sdk.vaults.getVaults({ disableCache: true })

// @ts-expect-error Cancel operations do not accept protocol-specific options.
void sdk.user.cancelDepositPTB(tx, vault, '0x1', '1', 'receipt-id', {})

// @ts-expect-error Rewards are selected by filtering getRewards output, not by coin type.
void sdk.user.claimRewardsPTB(tx, vault, '0x1', '0x2::coin::COIN')

// @ts-expect-error Slippage is not part of the common withdraw path.
void sdk.user.withdrawPTB(tx, vault, '0x1', { kind: 'all' }, { maxShares: '1' })

// @ts-expect-error Deposit exposes no slippage bound either.
void sdk.user.depositPTB(tx, vault, '0x1', '1.0', { slippageBps: 30 })
