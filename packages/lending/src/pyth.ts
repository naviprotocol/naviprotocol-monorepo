import type { NaviSuiClient } from './sui'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { SUI_CLOCK_OBJECT_ID } from '@mysten/sui/utils'

type HermesPrice = {
  price: string
  conf: string
  expo: number
  publish_time: number
}

type HermesPriceFeedResponse = {
  id: string
  price: HermesPrice
}

type PriceFeed = {
  id: string
  getPriceUnchecked(): {
    price: string
    conf: string
    expo: number
    publishTime: number
  }
}

type SuiPythProvider = Pick<NaviSuiClient, 'getObject' | 'getDynamicFieldObject'>

const MAX_ARGUMENT_SIZE = 16 * 1024

function normalizePriceId(priceId: string) {
  return priceId.replace(/^0x/i, '')
}

function hexToBytes(hex: string) {
  const normalized = normalizePriceId(hex)
  const bytes = new Uint8Array(normalized.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function readUint16BE(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) + bytes[offset + 1]
}

function toPureBytes(bytes: Uint8Array) {
  return bcs.vector(bcs.U8).serialize(Array.from(bytes), {
    maxSize: MAX_ARGUMENT_SIZE
  })
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

export class SuiPriceServiceConnection {
  private readonly endpoint: string
  private readonly timeout: number

  constructor(endpoint: string, options?: { timeout?: number }) {
    this.endpoint = endpoint.replace(/\/$/, '')
    this.timeout = options?.timeout ?? 10000
  }

  async getLatestPriceFeeds(priceIds: string[]): Promise<PriceFeed[] | undefined> {
    const data = await this.get<HermesPriceFeedResponse[]>('/api/latest_price_feeds', priceIds)
    return data.map((feed) => ({
      id: feed.id,
      getPriceUnchecked: () => ({
        price: feed.price.price,
        conf: feed.price.conf,
        expo: feed.price.expo,
        publishTime: feed.price.publish_time
      })
    }))
  }

  async getPriceFeedsUpdateData(priceIds: string[]): Promise<Uint8Array[]> {
    const vaas = await this.get<string[]>('/api/latest_vaas', priceIds)
    return vaas.map(base64ToBytes)
  }

  private async get<T>(pathname: string, priceIds: string[]): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeout)
    const url = new URL(`${this.endpoint}${pathname}`)
    for (const priceId of priceIds) {
      url.searchParams.append('ids[]', normalizePriceId(priceId))
    }

    try {
      const res = await fetch(url, {
        signal: controller.signal
      })
      if (!res.ok) {
        throw new Error(`Hermes request failed: ${res.status} ${res.statusText}`)
      }
      return (await res.json()) as T
    } finally {
      clearTimeout(timeout)
    }
  }
}

export class SuiPythClient {
  private pythPackageId?: string
  private wormholePackageId?: string
  private priceTableInfo?: {
    id: string
    fieldType: string
  }
  private readonly priceFeedObjectIdCache = new Map<string, string | undefined>()
  private baseUpdateFee?: number

  constructor(
    private readonly provider: SuiPythProvider,
    private readonly pythStateId: string,
    private readonly wormholeStateId: string
  ) {}

  async updatePriceFeeds(tx: Transaction, updates: Uint8Array[], feedIds: string[]) {
    const packageId = await this.getPythPackageId()
    const priceUpdatesHotPotato = await this.verifyVaasAndGetHotPotato(tx, updates, packageId)
    const baseUpdateFee = await this.getBaseUpdateFee()
    const coins = tx.splitCoins(
      tx.gas,
      feedIds.map(() => tx.pure.u64(baseUpdateFee))
    )
    return this.executePriceFeedUpdates(tx, packageId, feedIds, priceUpdatesHotPotato, coins)
  }

  private async getBaseUpdateFee() {
    if (this.baseUpdateFee === undefined) {
      const result = await this.provider.getObject({
        id: this.pythStateId,
        options: { showContent: true }
      })
      if (!result.data || !result.data.content || result.data.content.dataType !== 'moveObject') {
        throw new Error('Unable to fetch pyth state object')
      }
      this.baseUpdateFee = Number((result.data.content.fields as any).base_update_fee)
    }
    return this.baseUpdateFee
  }

  private async getPackageId(objectId: string) {
    const result = await this.provider.getObject({
      id: objectId,
      options: { showContent: true }
    })
    if (result.data?.content?.dataType === 'moveObject') {
      const fields = result.data.content.fields as any
      if ('upgrade_cap' in fields) {
        return fields.upgrade_cap.fields.package as string
      }
    }
    throw new Error(`Cannot fetch package id for object ${objectId}`)
  }

  private async verifyVaas(vaas: Uint8Array[], tx: Transaction) {
    const wormholePackageId = await this.getWormholePackageId()
    return vaas.map((vaa) => {
      const [verifiedVaa] = tx.moveCall({
        target: `${wormholePackageId}::vaa::parse_and_verify`,
        arguments: [
          tx.object(this.wormholeStateId),
          tx.pure(toPureBytes(vaa)),
          tx.object(SUI_CLOCK_OBJECT_ID)
        ]
      })
      return verifiedVaa
    })
  }

  private async verifyVaasAndGetHotPotato(
    tx: Transaction,
    updates: Uint8Array[],
    packageId: string
  ) {
    if (updates.length > 1) {
      throw new Error(
        'SDK does not support sending multiple accumulator messages in a single transaction'
      )
    }
    const vaa = this.extractVaaBytesFromAccumulatorMessage(updates[0])
    const [verifiedVaa] = await this.verifyVaas([vaa], tx)
    const [priceUpdatesHotPotato] = tx.moveCall({
      target: `${packageId}::pyth::create_authenticated_price_infos_using_accumulator`,
      arguments: [
        tx.object(this.pythStateId),
        tx.pure(toPureBytes(updates[0])),
        verifiedVaa,
        tx.object(SUI_CLOCK_OBJECT_ID)
      ]
    })
    return priceUpdatesHotPotato
  }

  private async executePriceFeedUpdates(
    tx: Transaction,
    packageId: string,
    feedIds: string[],
    priceUpdatesHotPotato: any,
    coins: any[]
  ) {
    const priceInfoObjects: string[] = []
    for (const [coinId, feedId] of feedIds.entries()) {
      const priceInfoObjectId = await this.getPriceFeedObjectId(feedId)
      if (!priceInfoObjectId) {
        throw new Error(`Price feed ${feedId} not found, please create it first`)
      }
      priceInfoObjects.push(priceInfoObjectId)
      ;[priceUpdatesHotPotato] = tx.moveCall({
        target: `${packageId}::pyth::update_single_price_feed`,
        arguments: [
          tx.object(this.pythStateId),
          priceUpdatesHotPotato,
          tx.object(priceInfoObjectId),
          coins[coinId],
          tx.object(SUI_CLOCK_OBJECT_ID)
        ]
      })
    }
    tx.moveCall({
      target: `${packageId}::hot_potato_vector::destroy`,
      arguments: [priceUpdatesHotPotato],
      typeArguments: [`${packageId}::price_info::PriceInfo`]
    })
    return priceInfoObjects
  }

  private async getWormholePackageId() {
    if (!this.wormholePackageId) {
      this.wormholePackageId = await this.getPackageId(this.wormholeStateId)
    }
    return this.wormholePackageId
  }

  private async getPythPackageId() {
    if (!this.pythPackageId) {
      this.pythPackageId = await this.getPackageId(this.pythStateId)
    }
    return this.pythPackageId
  }

  private async getPriceFeedObjectId(feedId: string) {
    const normalizedFeedId = normalizePriceId(feedId)
    if (!this.priceFeedObjectIdCache.has(normalizedFeedId)) {
      const { id: tableId, fieldType } = await this.getPriceTableInfo()
      const result = await this.provider.getDynamicFieldObject({
        parentId: tableId,
        name: {
          type: `${fieldType}::price_identifier::PriceIdentifier`,
          value: {
            bytes: Array.from(hexToBytes(normalizedFeedId))
          }
        }
      })
      if (!result.data || !result.data.content) {
        this.priceFeedObjectIdCache.set(normalizedFeedId, undefined)
      } else if (result.data.content.dataType !== 'moveObject') {
        throw new Error('Price feed type mismatch')
      } else {
        this.priceFeedObjectIdCache.set(normalizedFeedId, (result.data.content.fields as any).value)
      }
    }
    return this.priceFeedObjectIdCache.get(normalizedFeedId)
  }

  private async getPriceTableInfo() {
    if (!this.priceTableInfo) {
      const result = await this.provider.getDynamicFieldObject({
        parentId: this.pythStateId,
        name: {
          type: 'vector<u8>',
          value: 'price_info'
        }
      })
      if (!result.data || !result.data.type) {
        throw new Error('Price Table not found, contract may not be initialized')
      }
      let type = result.data.type.replace('0x2::table::Table<', '')
      type = type.replace('::price_identifier::PriceIdentifier, 0x2::object::ID>', '')
      this.priceTableInfo = {
        id: result.data.objectId,
        fieldType: type
      }
    }
    return this.priceTableInfo
  }

  private extractVaaBytesFromAccumulatorMessage(accumulatorMessage: Uint8Array) {
    const trailingPayloadSize = accumulatorMessage[6]
    const vaaSizeOffset = 7 + trailingPayloadSize + 1
    const vaaSize = readUint16BE(accumulatorMessage, vaaSizeOffset)
    const vaaOffset = vaaSizeOffset + 2
    return accumulatorMessage.subarray(vaaOffset, vaaOffset + vaaSize)
  }
}
