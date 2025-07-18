import './fetch'
import { describe, it, expect } from 'vitest'
import { WalletClient, WatchSigner } from '../src'
import { getFullnodeUrl } from '@mysten/sui/client'

import dotenv from 'dotenv'

dotenv.config()

const signer = new WatchSigner(
  process.env.address || '0xc41d2d2b2988e00f9b64e7c41a5e70ef58a3ef835703eeb6bf1bd17a9497d9fe'
)

const walletClient = new WalletClient({
  signer: signer,
  client: {
    url: (process.env.RPC_URL as string) || getFullnodeUrl('mainnet')
  }
})

describe('balance module', () => {
  it('module exists', async () => {
    expect(walletClient.module('balance')).toBeDefined()
  })

  it('update portfolio', async () => {
    await walletClient.module('balance').updatePortfolio()
    expect(walletClient.module('balance').coins.length).toBeGreaterThan(0)
  })

  it('portfolio', async () => {
    await walletClient.module('balance').waitForUpdate()
    const portfolio = walletClient.module('balance').portfolio
    expect(portfolio.balanceOf('0x2::sui::SUI').toNumber()).toBeGreaterThan(0)
    expect(portfolio.getBalance('0x2::sui::SUI').amount.toNumber()).toBeGreaterThan(0)
  })

  it('send coins to many', async () => {
    const receipts = [
      '0xfaba86400d9cc1d144bbc878bc45c4361d53a16c942202b22db5d26354801e8e',
      '0x91eb74aef86b5a7002c587704f6c0d5a627c4937bb7d6d659d83a911ae9f4c93'
    ]
    const amounts = [1e9 * 0.1, 1e9 * 0.1]
    const result = await walletClient
      .module('balance')
      .sendCoinBatch('0x2::sui::SUI', receipts, amounts, {
        dryRun: true
      })
    expect(result).toBeDefined()
    receipts.forEach((receipt, index) => {
      const balanceChange = result.balanceChanges.find(
        (change) => (change.owner as any).AddressOwner === receipt
      )
      expect(balanceChange?.amount).toBe(String(amounts[index]))
    })
  })

  it('transfer object', async () => {
    const recipient = '0xfaba86400d9cc1d144bbc878bc45c4361d53a16c942202b22db5d26354801e8e'
    const result = await walletClient
      .module('balance')
      .transferObject(
        '0xc0a4c8478d930a2f6a6ec19a79d55ecee564815b57b3f61d82233a9e4329bd50',
        recipient,
        {
          dryRun: true
        }
      )
    expect(result).toBeDefined()
    const object: any = result.objectChanges.find(
      (change: any) =>
        change.objectId === '0xc0a4c8478d930a2f6a6ec19a79d55ecee564815b57b3f61d82233a9e4329bd50'
    )
    expect(object.owner.AddressOwner).toBe(recipient)
  })
})
