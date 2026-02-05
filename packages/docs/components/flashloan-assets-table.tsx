'use client'

import { getAllFlashLoanAssets, getPools, normalizeCoinType } from '@naviprotocol/lending'
import type { FloashloanAsset, Pool } from '@naviprotocol/lending'
import { useCallback, useEffect, useMemo, useState } from 'react'

const REFRESH_INTERVAL_MS = 15000

function formatCoinType(coinType: string) {
  const parts = coinType.split('::')
  const symbol = parts[parts.length - 1] || coinType
  return {
    symbol,
    full: coinType
  }
}

function formatFee(fee: number) {
  if (Number.isNaN(fee)) return '-'
  return `${(fee * 100).toFixed(2)}%`
}

export default function FlashloanAssetsTable() {
  const [assets, setAssets] = useState<FloashloanAsset[]>([])
  const [poolMap, setPoolMap] = useState<Map<string, Pool>>(new Map())
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [campaignInput, setCampaignInput] = useState('')
  const [campaign, setCampaign] = useState<string | undefined>(undefined)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const campaignLabel = campaign ? `campaign: ${campaign}` : 'default'

  const loadAssets = useCallback(async (nextCampaign?: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const data = await getAllFlashLoanAssets({
        env: 'prod',
        campaign: nextCampaign,
        cacheTime: 10000
      } as any)
      setAssets(data)
      setLastUpdated(new Date())
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load flashloan assets'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const active = true

    const loadPools = async () => {
      try {
        const pools = await getPools({ env: 'prod', cacheTime: 60000 })
        if (!active) return
        const map = new Map<string, Pool>()
        pools.forEach((pool) => {
          map.set(normalizeCoinType(pool.suiCoinType), pool)
          map.set(normalizeCoinType(pool.coinType), pool)
          map.set(normalizeCoinType(pool.token.coinType), pool)
        })
        setPoolMap(map)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load pool data'
        setError(message)
      }
    }

    const run = async () => {
      if (!active) return
      await loadAssets(campaign)
    }

    loadPools()
  }, [campaign, loadAssets])

  const rows = useMemo(() => {
    return assets.map((asset) => {
      const normalizedCoinType = normalizeCoinType(asset.coinType)
      const pool = poolMap.get(normalizedCoinType)
      const tokenSymbol = pool?.token.symbol ?? formatCoinType(asset.coinType).symbol
      const tokenName = tokenSymbol
      const tokenLogo = pool?.token.logoUri ?? ''
      const { symbol, full } = formatCoinType(asset.coinType)
      return {
        symbol,
        tokenName,
        tokenLogo,
        full,
        flashloanFee: formatFee(asset.flashloanFee)
      }
    })
  }, [assets, poolMap])

  const handleApply = () => {
    const trimmed = campaignInput.trim()
    setCampaign(trimmed.length > 0 ? trimmed : undefined)
  }

  const handleClear = () => {
    setCampaignInput('')
    setCampaign(undefined)
  }

  return (
    <div className="not-prose rounded-xl border border-neutral-200 bg-white/60 p-4 shadow-sm backdrop-blur">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-neutral-800">Live Flashloan Fees</p>
          <p className="text-xs text-neutral-500">
            Auto refresh every 15 seconds · {campaignLabel}
          </p>
          {lastUpdated ? (
            <p className="text-xs text-neutral-400">
              Last updated: {lastUpdated.toLocaleTimeString()}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-neutral-500">
            Campaign
            <input
              className="mt-1 w-44 rounded-md border border-neutral-200 px-2 py-1 text-sm text-neutral-800"
              placeholder="campaign-id"
              value={campaignInput}
              onChange={(event) => setCampaignInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleApply()
                }
              }}
            />
          </label>
          <button
            type="button"
            className="rounded-md border cursor-pointer border-neutral-200 bg-neutral-900 px-3 py-1 text-xs font-semibold text-white transition hover:bg-neutral-800"
            onClick={handleApply}
          >
            Apply
          </button>
          <button
            type="button"
            className="rounded-md border cursor-pointer border-neutral-200 bg-white px-3 py-1 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-50"
            onClick={handleClear}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-neutral-200 max-h-[500px] overflow-y-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-100 text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-2">Token</th>
              <th className="px-4 py-2">Coin Type</th>
              <th className="px-4 py-2">Fee</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {isLoading ? (
              <tr>
                <td className="px-4 py-3 text-neutral-500" colSpan={4}>
                  Loading supported assets...
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td className="px-4 py-3 text-red-500" colSpan={4}>
                  {error}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-neutral-500" colSpan={4}>
                  No flashloan assets found for this campaign.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.full} className="hover:bg-neutral-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {row.tokenLogo ? (
                        <img
                          src={row.tokenLogo}
                          alt={row.tokenName}
                          className="h-6 w-6 rounded-full border border-neutral-200 object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-neutral-300 text-[10px] font-semibold text-neutral-400">
                          {row.symbol.slice(0, 2)}
                        </div>
                      )}
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-neutral-900">
                          {row.tokenName}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{row.full}</td>
                  <td className="px-4 py-3 text-neutral-900">{row.flashloanFee}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
