export type NaviDcaCoreClient = {
  core: unknown
}

export type NaviDcaCoreApi = {
  listCoins(options: any): Promise<any>
  getCoinMetadata(options: any): Promise<any>
  simulateTransaction(options: any): Promise<any>
}

export type NaviDcaPaginatedCoins = {
  data: any[]
  nextCursor?: string | null
  hasNextPage: boolean
}

export type NaviDcaCoinClient = NaviDcaCoreClient & {
  /** @deprecated Use `core.getCoinMetadata` on the injected v2 Core API client. */
  getCoinMetadata?(options: any): Promise<{ decimals?: number } | null | undefined>
  /** @deprecated Use `core.listCoins` on the injected v2 Core API client. */
  getCoins?(options: any): Promise<NaviDcaPaginatedCoins>
}

export type NaviDcaDryRunClient = NaviDcaCoreClient & {
  /** @deprecated Use `core.simulateTransaction` on the injected v2 Core API client. */
  dryRunTransactionBlock?(options: any): Promise<any>
}
