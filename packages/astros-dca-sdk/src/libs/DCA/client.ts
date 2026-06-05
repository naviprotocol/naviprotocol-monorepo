export type NaviDcaCoreClient = {
  core: unknown
}

export type NaviDcaPaginatedCoins = {
  data: any[]
  nextCursor?: string | null
  hasNextPage: boolean
}

export type NaviDcaCoinClient = NaviDcaCoreClient & {
  getCoinMetadata(options: any): Promise<{ decimals?: number } | null | undefined>
  getCoins(options: any): Promise<NaviDcaPaginatedCoins>
}

export type NaviDcaDryRunClient = NaviDcaCoreClient & {
  dryRunTransactionBlock(options: any): Promise<any>
}
