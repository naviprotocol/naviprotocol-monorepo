export enum Dex {
  CETUS = 'cetus',
  TURBOS = 'turbos',
  KRIYA_V2 = 'kriyaV2',
  KRIYA_V3 = 'kriyaV3',
  AFTERMATH = 'aftermath',
  DEEPBOOK = 'deepbook',
  BLUEFIN = 'bluefin',
  VSUI = 'vSui',
  HASUI = 'haSui',
  MAGMA = 'magma',
  MOMENTUM = 'momentum'
}

export type Quote = {
  routes: any[]
  amount_in: string
  amount_out: string
  from: string
  target: string
  dexList: Dex[]
  from_token?: {
    address: string
    decimals: number
    price: number
  }
  to_token?: {
    address: string
    decimals: number
    price: number
  }
  is_accurate?: boolean
}

export type FeeOption = {
  fee: number
  receiverAddress: string
}

export type SwapOptions = {
  baseUrl?: string
  dexList?: Dex[]
  byAmountIn?: boolean
  depth?: number
  feeOption?: FeeOption
  ifPrint?: boolean
  serviceFee?: FeeOption
}

export type Chain = {
  id: number
  name: string
  iconUrl: string
  nativeCurrency: Token
  rpcUrl: {
    default: string
  }
  blockExplorers: {
    default: {
      url: string
      name: string
    }
  }
}

export type Token = {
  address: string
  chainId: number
  decimals: number
  logoURI: string
  name: string
  chainName: string
  symbol: string
  isSuggest: boolean
  isVerify: boolean
  category: string[]
}

export type BridgeSwapOptions = {
  slippageBps?: number
  referrerBps?: number
}

export type BridgeSwapQuote = {
  provider: string
  amount_in: string
  amount_out: string
  slippage_bps: number
  min_amount_out: string
  from_token: Token
  to_token: Token
  total_fee: string
  spend_duration: number
  info_for_bridge: any
  path: {
    token: Token
    amount?: string
  }[]
}

export type BridgeRoutes = {
  routes: BridgeSwapQuote[]
}

export type BridgeSwapStatus = 'processing' | 'completed' | 'fail'

export type BridgeSwapTransaction = {
  id: string
  status: BridgeSwapStatus
  lastUpdateAt: string
  sourceChainId: number
  destChainId: number
  walletSourceAddress: string
  walletDestAddress: string
  totalFeeAmount: string
  sourceToken: {
    address: string
    symbol: string
    decimals: number
  }
  destToken: {
    address: string
    symbol: string
    decimals: number
  }
  hasSwap: boolean
  bridgeProvider: string
  bridgeStatus: BridgeSwapStatus
  bridgeFromToken: {
    address: string
    symbol: string
    decimals: number
  }
  bridgeToToken: {
    address: string
    symbol: string
    decimals: number
  }
  bridgeFromAmount: string
  bridgeToAmount: string
  bridgeStartAt: string
  bridgeEndAt?: string
  bridgeFeeAmount: string
  bridgeSourceTxHash: string
  bridgeDestTxHash?: string
  bridgeRefundTxHash?: string
  explorerLink?: string
  mayan?: any
}
