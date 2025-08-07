import './fetch'
import { describe, it, expect } from 'vitest'
import { WalletClient, WatchSigner } from '../src'
import { getFullnodeUrl } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'

import dotenv from 'dotenv'

dotenv.config()

const testAddress = '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'

const signer = new WatchSigner(testAddress)

const walletClient = new WalletClient({
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

  it('usdt -> usdy', async () => {
    const tx = new Transaction()
    await walletClient.lending.migrateBetweenSupplyPTB(
      tx,
      '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN',
      '0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY',
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
  it('wUSDC -> usdt', async () => {
    const tx = new Transaction()
    await walletClient.lending.migrateBetweenBorrowPTB(
      tx,
      '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN',
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
        return event.type.includes('lending::BorrowEvent')
      }) ?? []

    expect(res.effects.status.status).eql('success')
    expect(depositEvents.length).toBeGreaterThan(0)
  })

  it('haSUI -> usdy', async () => {
    const tx = new Transaction()
    await walletClient.lending.migrateBetweenBorrowPTB(
      tx,
      '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
      '0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY',
      {
        amount: 1e9,
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
        amount: 1e9,
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
