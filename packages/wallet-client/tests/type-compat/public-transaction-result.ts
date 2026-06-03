import type {
  DryRunTransactionBlockResponse,
  SuiTransactionBlockResponse
} from '@mysten/sui/jsonRpc'
import type {
  NaviDryRunTransactionResult,
  NaviExecuteTransactionResult,
  NaviWalletTransactionResult,
  WalletClient
} from '../../dist/index'

declare const walletClient: WalletClient

async function acceptsPublicWalletTransactionDto() {
  const dryRunResult = await walletClient.balance.sendCoin(
    '0x2::sui::SUI',
    walletClient.address,
    1,
    {
      dryRun: true
    }
  )
  const executeResult = await walletClient.balance.sendCoin(
    '0x2::sui::SUI',
    walletClient.address,
    1,
    {
      dryRun: false
    }
  )

  const dryRunDto: NaviDryRunTransactionResult = dryRunResult
  const executeDto: NaviExecuteTransactionResult = executeResult
  const conditionalDto: NaviWalletTransactionResult<true> = dryRunResult

  dryRunDto.kind satisfies 'dryRun'
  executeDto.kind satisfies 'execute'
  dryRunDto.events[0]?.type satisfies string | undefined
  executeDto.effects?.status?.status satisfies string | undefined
  conditionalDto.balanceChanges[0]?.amount satisfies string | undefined

  // @ts-expect-error NAVI v2 wallet methods do not expose raw JSON-RPC dry-run responses.
  const rawDryRun: DryRunTransactionBlockResponse = dryRunResult

  // @ts-expect-error NAVI v2 wallet methods do not expose raw JSON-RPC execute responses.
  const rawExecute: SuiTransactionBlockResponse = executeResult

  void rawDryRun
  void rawExecute
}

void acceptsPublicWalletTransactionDto
