import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'

export type NaviCoreClient = {
  core: unknown
}

export type NaviJsonRpcCompatClient = NaviCoreClient & {
  devInspectTransactionBlock(options: any): Promise<any>
  dryRunTransactionBlock(options: any): Promise<any>
  executeTransactionBlock(options: any): Promise<any>
  getAllCoins(options: any): Promise<any>
  getCoinMetadata(options: any): Promise<any>
  getCoins(options: any): Promise<any>
  getDynamicFieldObject(options: any): Promise<any>
  getObject(options: any): Promise<any>
  getTransactionBlock(options: any): Promise<any>
  multiGetObjects(options: any): Promise<any>
  signAndExecuteTransaction(options: any): Promise<any>
  waitForTransaction(options: any): Promise<any>
}

export type NaviSuiClient = NaviJsonRpcCompatClient

export function createNaviSuiClient(
  url = getJsonRpcFullnodeUrl('mainnet'),
  network: 'mainnet' | 'testnet' | 'devnet' | 'localnet' | (string & {}) = 'mainnet'
): NaviSuiClient {
  return new SuiJsonRpcClient({
    network,
    url
  })
}
