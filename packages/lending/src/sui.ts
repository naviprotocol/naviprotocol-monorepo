import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'

export type NaviSuiClient = SuiJsonRpcClient

export function createNaviSuiClient(
  url = getJsonRpcFullnodeUrl('mainnet'),
  network: 'mainnet' | 'testnet' | 'devnet' | 'localnet' | (string & {}) = 'mainnet'
) {
  return new SuiJsonRpcClient({
    network,
    url
  })
}
