import './fetch'
import { describe, it, expect } from 'vitest'
import { WalletClient, WatchSigner } from '../src'
import { getFullnodeUrl } from '@mysten/sui/client'
import { normalizeStructTag } from '@mysten/sui/utils'
import { Transaction } from '@mysten/sui/transactions'

import dotenv from 'dotenv'
import { normalize } from 'path'

dotenv.config()

const testAddress = '0x4a662a70184c9e8f62e9d298c9969318a74cec5e9d3b5e0616a687052e654e57'

const signer = new WatchSigner(testAddress)

const walletClient = new WalletClient({
  signer: signer,
  client: {
    url: (process.env.RPC_URL as string) || getFullnodeUrl('mainnet')
  }
})

const suilendWalletClient = new WalletClient({
  signer: signer,
  client: {
    url: (process.env.RPC_URL as string) || getFullnodeUrl('mainnet')
  }
})

describe('lending supply migration', () => {
  it('usdy -> usdt', async () => {
    const tx = new Transaction()
    await walletClient.lending.migrateBetweenSupplyPTB(
      tx,
      '0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY',
      '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN',
      {
        amount: 1e6,
        slippage: 0.002
      }
    )
    tx.setSender(testAddress)
    const dryRunTxBytes: Uint8Array = await tx.build({
      client: walletClient.client
    })
    const res = await walletClient.client.dryRunTransactionBlock({
      transactionBlock: dryRunTxBytes
    })

    const depositEvents =
      res.events?.filter((event) => {
        return event.type.includes('lending::DepositEvent')
      }) ?? []

    expect(res.effects.status.status).eql('success')
    expect(depositEvents.length).toBeGreaterThan(0)
  })
})

describe('lending borrow migration', () => {
  it('vSUI -> hasui', async () => {
    const tx = new Transaction()
    await walletClient.lending.migrateBetweenBorrowPTB(
      tx,
      '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
      '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
      {
        amount: 255687914,
        slippage: 0.002
      }
    )
    tx.setSender(testAddress)
    const dryRunTxBytes: Uint8Array = await tx.build({
      client: walletClient.client
    })
    const res = await walletClient.client.dryRunTransactionBlock({
      transactionBlock: dryRunTxBytes
    })

    const depositEvents =
      res.events?.filter((event) => {
        return event.type.includes('lending::BorrowEvent')
      }) ?? []

    expect(res.effects.status.status).eql('success')
    expect(depositEvents.length).toBeGreaterThan(0)
  })
})

describe('lending balance migration', () => {
  it('vSUI -> usdt', async () => {
    const tx = new Transaction()
    await walletClient.lending.migrateBalanceToSupplyPTB(
      tx,
      '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
      '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN',
      {
        amount: 973139597,
        slippage: 0.002
      }
    )
    tx.setSender(testAddress)
    const dryRunTxBytes: Uint8Array = await tx.build({
      client: walletClient.client
    })
    const res = await walletClient.client.dryRunTransactionBlock({
      transactionBlock: dryRunTxBytes
    })

    const depositEvents =
      res.events?.filter((event) => {
        return event.type.includes('lending::DepositEvent')
      }) ?? []

    expect(res.effects.status.status).eql('success')
    expect(depositEvents.length).toBeGreaterThan(0)
  })
})

describe('cross-protocol supply migration', () => {
  it('suilend usdc -> navi usdt', async () => {
    const tx = new Transaction()
    await suilendWalletClient.lending.migrateBetweenSupplyPTB(
      tx,
      '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN',
      {
        protocol: 'suilend',
        amount: 1e6,
        slippage: 0.002
      }
    )
    tx.setSender(testAddress)
    const dryRunTxBytes: Uint8Array = await tx.build({
      client: suilendWalletClient.client
    })
    const res = await suilendWalletClient.client.dryRunTransactionBlock({
      transactionBlock: dryRunTxBytes
    })
    expect(res.effects.status.status).eql('success')
  })
})

describe('cross-protocol borrow migration', () => {
  it('suilend sui -> navi hasui', async () => {
    const tx = new Transaction()
    await suilendWalletClient.lending.migrateBetweenBorrowPTB(
      tx,
      normalizeStructTag('0x2::sui::SUI'),
      '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
      {
        protocol: 'suilend',
        amount: 300000000,
        slippage: 0.01
      }
    )
    tx.setSender(testAddress)
    const dryRunTxBytes: Uint8Array = await tx.build({
      client: suilendWalletClient.client
    })
    const res = await suilendWalletClient.client.dryRunTransactionBlock({
      transactionBlock: dryRunTxBytes
    })
    expect(res.effects.status.status).eql('success')
  })
})
