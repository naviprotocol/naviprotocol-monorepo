'use client'

import { getAllFlashLoanAssets, getPools, normalizeCoinType } from '@naviprotocol/lending'
import type { FloashloanAsset, Pool } from '@naviprotocol/lending'
import { useCallback, useEffect, useMemo, useState } from 'react'

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

  const loadAssets = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const data = await getAllFlashLoanAssets({
        env: 'prod',
        cacheTime: 10000
      } as any)
      setAssets(data)
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
      await loadAssets()
    }

    loadPools()
    run()
  }, [loadAssets])

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

  return (
    <div className="not-prose rounded-xl border border-neutral-200 bg-white/60 p-4 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/60">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          Live Flashloan Fees
        </p>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-neutral-200 max-h-[500px] overflow-y-auto dark:border-neutral-700">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-100 text-xs uppercase text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
            <tr>
              <th className="px-4 py-2">Token</th>
              <th className="px-4 py-2">Coin Type</th>
              <th className="px-4 py-2">Fee</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
            {isLoading ? (
              <tr>
                <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400" colSpan={4}>
                  Loading supported assets...
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td className="px-4 py-3 text-red-500 dark:text-red-400" colSpan={4}>
                  {error}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400" colSpan={4}>
                  No flashloan assets found.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.full} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {row.tokenLogo ? (
                        <img
                          src={row.tokenLogo}
                          alt={row.tokenName}
                          className="h-6 w-6 rounded-full border border-neutral-200 object-cover dark:border-neutral-600"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-neutral-300 text-[10px] font-semibold text-neutral-400 dark:border-neutral-600 dark:text-neutral-500">
                          {row.symbol.slice(0, 2)}
                        </div>
                      )}
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                          {row.tokenName}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500 dark:text-neutral-400">
                    {row.full}
                  </td>
                  <td className="px-4 py-3 text-neutral-900 dark:text-neutral-100">
                    {row.flashloanFee}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
