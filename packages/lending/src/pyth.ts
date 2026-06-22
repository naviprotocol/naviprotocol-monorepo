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

type HermesPriceUpdateResponse = {
  binary?: {
    encoding?: string
    data?: string[]
  }
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

type CoreDynamicFieldName = {
  type: string
  bcs: Uint8Array
}

type SuiPythProvider = Partial<Pick<NaviSuiClient, 'getObject' | 'getDynamicFieldObject'>> & {
  core?: unknown
}

type SuiPythCoreProvider = {
  getObject(options: {
    objectId: string
    include?: { json?: boolean; content?: boolean }
  }): Promise<{
    object?: { objectId: string; type?: string; json?: Record<string, unknown> | null }
  }>
  getDynamicObjectField(options: {
    parentId: string
    name: CoreDynamicFieldName
    include?: { json?: boolean; content?: boolean }
  }): Promise<{
    object?: { objectId: string; type?: string; json?: Record<string, unknown> | null }
  }>
}

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

function toDynamicFieldName(type: string, bytes: Uint8Array): CoreDynamicFieldName {
  return {
    type,
    bcs: bytes
  }
}

function encodeVectorU8(value: string) {
  return bcs
    .vector(bcs.U8)
    .serialize(Array.from(new TextEncoder().encode(value)))
    .toBytes()
}

function encodePriceIdentifier(bytes: Uint8Array) {
  return bcs
    .struct('PriceIdentifier', {
      bytes: bcs.vector(bcs.U8)
    })
    .serialize({
      bytes: Array.from(bytes)
    })
    .toBytes()
}

function splitTopLevelTypeArgs(args: string) {
  const parts: string[] = []
  let depth = 0
  let start = 0

  for (let index = 0; index < args.length; index += 1) {
    const char = args[index]
    if (char === '<') {
      depth += 1
    } else if (char === '>') {
      depth -= 1
    } else if (char === ',' && depth === 0) {
      parts.push(args.slice(start, index).trim())
      start = index + 1
    }
  }

  parts.push(args.slice(start).trim())
  return parts
}

function getPythPackageIdFromPriceTableType(type: string) {
  const tablePrefix = '::table::Table'
  const tableIndex = type.indexOf(tablePrefix)
  const argsStart = type.indexOf('<', tableIndex)
  const argsEnd = type.lastIndexOf('>')
  const priceIdentifierSuffix = '::price_identifier::PriceIdentifier'

  if (tableIndex < 0 || argsStart < 0 || argsEnd <= argsStart) {
    throw new Error(`Unexpected Pyth price table type: ${type}`)
  }

  const [keyType, valueType] = splitTopLevelTypeArgs(type.slice(argsStart + 1, argsEnd))
  if (!keyType?.endsWith(priceIdentifierSuffix) || !valueType?.endsWith('::object::ID')) {
    throw new Error(`Unexpected Pyth price table type arguments: ${type}`)
  }

  return keyType.slice(0, -priceIdentifierSuffix.length)
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
    const response = await this.get<HermesPriceUpdateResponse>(
      '/v2/updates/price/latest',
      priceIds,
      {
        encoding: 'base64',
        parsed: 'false'
      }
    )
    const encoding = response.binary?.encoding
    const data = response.binary?.data ?? []

    if (encoding && encoding !== 'base64') {
      throw new Error(`Unsupported Hermes price update encoding: ${encoding}`)
    }

    if (data.length === 0) {
      throw new Error('Hermes price update response did not include binary update data')
    }

    return data.map(base64ToBytes)
  }

  private async get<T>(
    pathname: string,
    priceIds: string[],
    searchParams?: Record<string, string>
  ): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeout)
    const url = new URL(`${this.endpoint}${pathname}`)

    for (const [key, value] of Object.entries(searchParams ?? {})) {
      url.searchParams.set(key, value)
    }

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

  private getCoreProvider(): SuiPythCoreProvider | null {
    const core = this.provider.core as Partial<SuiPythCoreProvider> | undefined
    if (
      core &&
      typeof core.getObject === 'function' &&
      typeof core.getDynamicObjectField === 'function'
    ) {
      return core as SuiPythCoreProvider
    }
    return null
  }

  private async getMoveObjectJson(objectId: string) {
    const core = this.getCoreProvider()
    if (core) {
      const result = await core.getObject({
        objectId,
        include: { json: true }
      })
      if (!result.object) {
        return null
      }
      return {
        objectId: result.object.objectId,
        type: result.object.type,
        fields: result.object.json
      }
    }

    if (!this.provider.getObject) {
      throw new Error('Sui Pyth provider does not support getObject')
    }
    const result = await this.provider.getObject({
      id: objectId,
      options: { showContent: true }
    })
    if (!result.data || !result.data.content || result.data.content.dataType !== 'moveObject') {
      return null
    }
    return {
      objectId: result.data.objectId,
      type: result.data.type,
      fields: result.data.content.fields as Record<string, unknown>
    }
  }

  private async getDynamicMoveObjectJson(parentId: string, name: CoreDynamicFieldName | any) {
    const core = this.getCoreProvider()
    if (core) {
      const result = await core.getDynamicObjectField({
        parentId,
        name,
        include: { json: true }
      })
      if (!result.object) {
        return null
      }
      return {
        objectId: result.object.objectId,
        type: result.object.type,
        fields: result.object.json
      }
    }

    if (!this.provider.getDynamicFieldObject) {
      throw new Error('Sui Pyth provider does not support getDynamicFieldObject')
    }
    const result = await this.provider.getDynamicFieldObject({
      parentId,
      name
    })
    if (!result.data) {
      return null
    }
    if (!result.data.content) {
      return {
        objectId: result.data.objectId,
        type: result.data.type,
        fields: undefined
      }
    }
    if (result.data.content.dataType !== 'moveObject') {
      return null
    }
    return {
      objectId: result.data.objectId,
      type: result.data.type,
      fields: result.data.content.fields as Record<string, unknown>
    }
  }

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
      const result = await this.getMoveObjectJson(this.pythStateId)
      if (!result?.fields) {
        throw new Error('Unable to fetch pyth state object')
      }
      this.baseUpdateFee = Number((result.fields as any).base_update_fee)
    }
    return this.baseUpdateFee
  }

  private async getPackageId(objectId: string) {
    const result = await this.getMoveObjectJson(objectId)
    if (result?.fields) {
      const fields = result.fields as any
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
      const fieldName = this.getCoreProvider()
        ? toDynamicFieldName(
            `${fieldType}::price_identifier::PriceIdentifier`,
            encodePriceIdentifier(hexToBytes(normalizedFeedId))
          )
        : {
            type: `${fieldType}::price_identifier::PriceIdentifier`,
            value: {
              bytes: Array.from(hexToBytes(normalizedFeedId))
            }
          }
      const result = await this.getDynamicMoveObjectJson(tableId, fieldName)
      if (!result?.fields) {
        this.priceFeedObjectIdCache.set(normalizedFeedId, undefined)
      } else {
        this.priceFeedObjectIdCache.set(normalizedFeedId, (result.fields as any).value)
      }
    }
    return this.priceFeedObjectIdCache.get(normalizedFeedId)
  }

  private async getPriceTableInfo() {
    if (!this.priceTableInfo) {
      const fieldName = this.getCoreProvider()
        ? toDynamicFieldName('vector<u8>', encodeVectorU8('price_info'))
        : {
            type: 'vector<u8>',
            value: 'price_info'
          }
      const result = await this.getDynamicMoveObjectJson(this.pythStateId, fieldName)
      if (!result?.type) {
        throw new Error('Price Table not found, contract may not be initialized')
      }
      this.priceTableInfo = {
        id: result.objectId,
        fieldType: getPythPackageIdFromPriceTableType(result.type)
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
