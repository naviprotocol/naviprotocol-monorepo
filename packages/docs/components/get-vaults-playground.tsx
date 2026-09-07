'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import type { GetVaultsOptions, Vault, VaultProtocol } from '@naviprotocol/vault'

const protocols: VaultProtocol[] = ['navi', 'volo', 'astros']
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 })
const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2
})

export default function GetVaultsPlayground() {
  const [filter, setFilter] = useState(false)
  const [selected, setSelected] = useState<VaultProtocol[]>(['navi'])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    vaults: Vault[]
    code: string
    elapsed: number
  } | null>(null)
  const options: GetVaultsOptions = filter ? { protocols: selected } : {}
  const code = `import { getVaults } from '@naviprotocol/vault'\n\nconst vaults = await getVaults(${JSON.stringify(options, null, 2)})`
  const changed = result !== null && result.code !== code

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading) return
    setLoading(true)
    setError(null)
    setResult(null)
    const started = performance.now()
    try {
      const { getVaults } = await import('@naviprotocol/vault')
      const vaults = await getVaults(options)
      setResult({ vaults, code, elapsed: Math.round(performance.now() - started) })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load vaults. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="not-prose my-6 min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      data-testid="get-vaults-playground"
    >
      <div className="border-b border-fd-border p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">getVaults playground</h3>
          <span className="rounded-full border border-fd-border px-2 py-1 text-xs text-fd-muted-foreground">
            Production API
          </span>
        </div>
        <p className="mt-2 text-sm text-fd-muted-foreground">
          Choose parameters and run a real SDK request. No wallet is required.
        </p>
      </div>
      <form onSubmit={run} className="p-5">
        <fieldset disabled={loading} className="space-y-5 disabled:opacity-60">
          <legend className="sr-only">getVaults parameters</legend>
          <div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={filter}
                onChange={(event) => setFilter(event.target.checked)}
              />
              Filter by strategy provider
            </label>
            {filter ? (
              <div className="mt-3 flex flex-wrap gap-3">
                {protocols.map((protocol) => (
                  <label
                    key={protocol}
                    className="flex items-center gap-2 rounded-md border border-fd-border px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(protocol)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? protocols.filter(
                                (item) => item === protocol || current.includes(item)
                              )
                            : current.filter((item) => item !== protocol)
                        )
                      }
                    />
                    {protocol}
                  </label>
                ))}
              </div>
            ) : null}
            <p className="mt-2 text-xs text-fd-muted-foreground">
              {filter
                ? 'protocols filters the strategy provider, not source. Selecting none returns an empty list.'
                : 'protocols is omitted: return all vaults.'}
            </p>
          </div>
          <button
            type="submit"
            className="rounded-md bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Loading vaults…' : 'Run getVaults'}
          </button>
        </fieldset>
      </form>
      <div className="border-t border-fd-border bg-fd-muted/40 p-5">
        <p className="mb-3 text-xs font-medium text-fd-muted-foreground">
          SDK call · current parameters
        </p>
        <pre className="overflow-x-auto text-xs leading-6">
          <code>{code}</code>
        </pre>
      </div>
      <div className="border-t border-fd-border" aria-busy={loading}>
        <div className="p-5 text-sm" role="status">
          {loading
            ? 'Fetching vaults…'
            : error
              ? 'Request failed.'
              : result
                ? `${result.vaults.length} vaults returned · ${result.elapsed} ms${changed ? ' · Parameters changed. Run again to update these results.' : ''}`
                : 'Run getVaults to see results here.'}
        </div>
        {error ? (
          <p role="alert" className="px-5 pb-5 text-sm text-red-600 dark:text-red-400">
            {error} Check your connection and run the request again.
          </p>
        ) : null}
        {result?.vaults.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-fd-muted-foreground">
            No vaults match these parameters. Try another strategy provider or turn off filtering.
          </p>
        ) : null}
        {result && result.vaults.length > 0 ? (
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Vaults returned by the last getVaults request</caption>
              <thead className="sticky top-0 bg-fd-muted">
                <tr>
                  {['Vault', 'Asset', 'Protocol', 'Source', 'Status', '7-day APY', 'TVL (USD)'].map(
                    (heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className="whitespace-nowrap px-4 py-3 text-xs font-medium"
                      >
                        {heading}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {result.vaults.map((vault) => (
                  <tr key={vault.id} className="border-t border-fd-border">
                    <td className="min-w-48 px-4 py-3">
                      <div className="font-medium">{vault.name}</div>
                      <span className="block max-w-64 break-all font-mono text-xs text-fd-muted-foreground">
                        {vault.id}
                      </span>
                    </td>
                    <td className="px-4 py-3">{vault.assets.baseCoin.symbol}</td>
                    <td className="px-4 py-3">{vault.protocol}</td>
                    <td className="px-4 py-3">{vault.source}</td>
                    <td className="px-4 py-3">{vault.status ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                      {vault.apy.avg7d == null ? '—' : percent.format(vault.apy.avg7d)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">
                      {vault.totalStakedUsd == null ? '—' : currency.format(vault.totalStakedUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {result ? (
          <details className="border-t border-fd-border p-5 text-sm">
            <summary className="cursor-pointer">Full response · JSON</summary>
            <pre className="mt-3 max-h-80 overflow-auto text-xs">
              <code>{JSON.stringify(result.vaults, null, 2)}</code>
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  )
}
