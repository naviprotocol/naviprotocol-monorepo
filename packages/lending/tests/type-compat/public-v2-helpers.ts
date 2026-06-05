import { Transaction } from '@mysten/sui/transactions'
import { getJsonRpcFullnodeUrl, SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import {
  createNaviSuiClient,
  SuiPriceServiceConnection,
  SuiPythClient,
  type NaviJsonRpcCompatClient,
  type NaviSuiClient
} from '@naviprotocol/lending'

const client: NaviSuiClient = createNaviSuiClient()
const customClient: NaviSuiClient = createNaviSuiClient(
  'https://fullnode.mainnet.sui.io:443',
  'mainnet'
)
const jsonRpcClient: NaviJsonRpcCompatClient = new SuiJsonRpcClient({
  network: 'mainnet',
  url: getJsonRpcFullnodeUrl('mainnet')
})

const connection = new SuiPriceServiceConnection('https://hermes.pyth.network')
const pyth = new SuiPythClient(
  customClient,
  '0x0000000000000000000000000000000000000000000000000000000000000001',
  '0x0000000000000000000000000000000000000000000000000000000000000002'
)

async function buildPythUpdate() {
  const tx = new Transaction()
  const updates = await connection.getPriceFeedsUpdateData(['0xe62df6c8b4a85fe1a67a56e9a2a15'])

  await pyth.updatePriceFeeds(tx, updates, ['0xe62df6c8b4a85fe1a67a56e9a2a15'])
  return tx
}

void client
void jsonRpcClient
void buildPythUpdate
