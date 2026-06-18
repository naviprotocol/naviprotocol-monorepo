import {
  createNaviSuiClientBundle,
  type NaviSuiClientBundle,
  type NaviSuiClientOptions
} from '@naviprotocol/lending'

const grpcCoreClient = {
  core: {
    getObject: async () => ({}),
    listCoins: async () => ({ objects: [] }),
    getBalance: async () => ({ balance: { balance: '0', coinBalance: '0', addressBalance: '0' } }),
    listBalances: async () => ({ balances: [], hasNextPage: false, cursor: null }),
    simulateTransaction: async () => ({ $kind: 'Transaction', Transaction: { digest: 'digest' } }),
    executeTransaction: async () => ({ $kind: 'Transaction', Transaction: { digest: 'digest' } })
  }
}

const graphqlClient = {
  ...grpcCoreClient,
  query: async () => ({ data: {} })
}

const legacyJsonRpcClient = {
  ...grpcCoreClient,
  devInspectTransactionBlock: async () => ({}),
  dryRunTransactionBlock: async () => ({}),
  executeTransactionBlock: async () => ({}),
  getAllCoins: async () => ({}),
  getCoinMetadata: async () => ({}),
  getCoins: async () => ({}),
  getDynamicFieldObject: async () => ({}),
  getObject: async () => ({}),
  getTransactionBlock: async () => ({}),
  multiGetObjects: async () => ({}),
  signAndExecuteTransaction: async () => ({}),
  waitForTransaction: async () => ({})
}

const urlOptions = {
  network: 'mainnet',
  grpc: {
    url: 'https://grpc.example'
  },
  graphql: {
    url: 'https://graphql.example',
    headers: {
      authorization: 'test-token'
    }
  },
  legacyJsonRpc: {
    url: 'https://json-rpc.example'
  },
  services: {
    naviOpenApi: {
      baseUrl: 'https://open-api-preview.example/api'
    }
  }
} satisfies NaviSuiClientOptions

const injectedOptions = {
  network: 'mainnet',
  grpc: {
    client: grpcCoreClient
  },
  graphql: {
    client: graphqlClient
  },
  legacyJsonRpc: {
    client: legacyJsonRpcClient
  }
} satisfies NaviSuiClientOptions

const bundle = createNaviSuiClientBundle(injectedOptions)

bundle satisfies NaviSuiClientBundle
bundle.coreClient.core satisfies unknown
bundle.grpc.core satisfies unknown
bundle.graphql?.query satisfies ((options: any) => Promise<any>) | undefined
bundle.legacyJsonRpc?.getCoins satisfies ((options: any) => Promise<any>) | undefined

void urlOptions
