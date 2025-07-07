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
