export interface VaultTransportRequest {
  path: string
  query?: Record<string, string | number | boolean | undefined>
  headers?: Record<string, string>
}

export interface VaultTransport {
  get<T>(request: VaultTransportRequest): Promise<T>
}
