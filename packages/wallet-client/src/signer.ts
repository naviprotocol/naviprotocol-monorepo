import { Signer } from '@mysten/sui/cryptography'
import { Transaction } from '@mysten/sui/transactions'
import { SuiClient } from '@mysten/sui/client'

interface SignAndExecuteOptions {
  transaction: Transaction
  client: SuiClient
}

export class WatchSigner extends Signer {
  private address: string

  constructor(address: string) {
    super()
    this.address = address
  }

  async sign(bytes: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array([])
  }

  getPublicKey(): any {
    return {
      toSuiAddress: () => this.address,
      toBytes: () => new Uint8Array(32),
      toRawBytes: () => new Uint8Array(32),
      flag: 0,
      verify: async () => false
    }
  }

  getKeyScheme(): any {
    return 'ed25519'
  }

  async signAndExecuteTransaction({ transaction, client }: SignAndExecuteOptions): Promise<any> {
    return {} as any
  }
}
