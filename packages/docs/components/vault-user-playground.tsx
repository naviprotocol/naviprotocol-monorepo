'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { isValidSuiAddress } from '@mysten/sui/utils'
import type { VaultProtocol } from '@naviprotocol/vault'

type Method = 'getPositions' | 'getVaultRewards' | 'getPendingRequests'
const protocols: VaultProtocol[] = ['navi', 'volo', 'astros']
const columns: Record<Method, string[]> = {
  getPositions: [
    'Vault address',
    'Protocol',
    'Source',
    'Shares (raw)',
    'Token balance',
    'Value (USD)',
    'APR',
    'Lifetime yield (USD)'
  ],
  getVaultRewards: [
    'Vault address',
    'Receipt address',
    'Reward coin type',
    'Claimable (raw, settled)',
    'Claimed (raw)'
  ],
  getPendingRequests: [
    'Vault address',
    'Type',
    'Amount (vault coin)',
    'Amount (USD)',
    'Shares (raw)',
    'Receipt address',
    'Request ID',
    'Expected execution (ISO 8601)'
  ]
}
const percentage = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 })
const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2
})
const display = (value: string | number | bigint | null) => (value == null ? '—' : String(value))

export default function VaultUserPlayground({ method }: { method: Method }) {
  const [owner, setOwner] = useState('')
  const [vault, setVault] = useState('')
  const [filter, setFilter] = useState(false)
  const [selected, setSelected] = useState<VaultProtocol[]>(['navi'])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    rows: string[][]
    json: string
    code: string
    elapsed: number
  } | null>(null)
  const address = owner.trim()
  const vaultIds = vault
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
  const rewards = method === 'getVaultRewards'
  const positions = method === 'getPositions'
  const validOwner = isValidSuiAddress(address)
  const validVault =
    (positions || vaultIds.length <= 1) &&
    (!rewards || vaultIds.length === 1) &&
    vaultIds.every(isValidSuiAddress)
  const valid = validOwner && validVault
  const positionOptions = {
    ...(filter ? { protocols: selected } : {}),
    ...(vaultIds.length ? { vaults: vaultIds } : {})
  }
  const requestOptions = vaultIds.length ? { vault: vaultIds[0] } : {}
  const options = positions ? positionOptions : requestOptions
  const args = rewards
    ? `${JSON.stringify(vaultIds[0] ?? '')}, ${JSON.stringify(address)}`
    : `${JSON.stringify(address)}${Object.keys(options).length ? `, ${JSON.stringify(options, null, 2)}` : ''}`
  const code = `import { ${method} } from '@naviprotocol/vault'\n\nconst result = await ${method}(${args})`

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!valid || loading) return
    setLoading(true)
    setError(null)
    setResult(null)
    const started = performance.now()
    try {
      const sdk = await import('@naviprotocol/vault')
      let rows: string[][]
      let data: unknown
      if (method === 'getPositions') {
        const values = await sdk.getPositions(address, positionOptions)
        data = values
        rows = values.map((item) => [
          item.vaultId,
          item.protocol,
          item.source,
          display(item.shares),
          display(item.tokenBalance),
          item.tokenUsd == null ? '—' : usd.format(item.tokenUsd),
          item.apr == null ? '—' : percentage.format(item.apr),
          item.yieldLifetimeUsd == null ? '—' : usd.format(item.yieldLifetimeUsd)
        ])
      } else if (method === 'getVaultRewards') {
        const values = await sdk.getVaultRewards(vaultIds[0], address)
        data = values
        rows = values.map((item) => [
          item.vault.id,
          item.receipt,
          item.rewardCoinType,
          display(item.claimable),
          display(item.claimed)
        ])
      } else {
        const values = await sdk.getPendingRequests(address, requestOptions)
        data = values
        rows = values.map((item) => [
          item.vaultId,
          item.type,
          item.amount,
          item.amountUsd,
          item.shares,
          item.receiptId,
          item.requestId,
          item.executeTime
        ])
      }
      setResult({
        rows,
        json: JSON.stringify(
          data,
          (_, value) => (typeof value === 'bigint' ? value.toString() : value),
          2
        ),
        code,
        elapsed: Math.round(performance.now() - started)
      })
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to complete the request. Please try again.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="not-prose my-6 min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      data-testid={`${method}-playground`}
    >
      <div className="border-b border-fd-border p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{method} playground</h3>
          <span className="rounded-full border border-fd-border px-2 py-1 text-xs text-fd-muted-foreground">
            {rewards ? 'Mainnet · on-chain rewards' : 'Production API'}
          </span>
        </div>
        <p className="mt-2 text-sm text-fd-muted-foreground">
          Enter a public wallet address to query its data. No wallet connection is required.
        </p>
        {rewards ? (
          <p className="mt-2 text-sm text-fd-muted-foreground">
            Rewards are available for NAVI-served vaults only; Volo returns an empty list. Claimable
            includes settled rewards only. Amounts use raw coin units; bigint values are serialized
            as strings in JSON.
          </p>
        ) : null}
      </div>
      <form onSubmit={run} className="p-5">
        <fieldset disabled={loading} className="min-w-0 space-y-5 disabled:opacity-60">
          <legend className="sr-only">{method} parameters</legend>
          <label className="grid gap-2 text-sm font-medium">
            Wallet address
            <input
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              placeholder="0x…"
              required
              spellCheck={false}
              autoCapitalize="none"
              aria-invalid={owner !== '' && !validOwner}
              className="min-w-0 w-full rounded-md border border-fd-border bg-fd-background px-3 py-2 font-mono text-xs"
            />
          </label>
          {owner !== '' && !validOwner ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              Enter a full Sui wallet address (0x followed by 64 hexadecimal characters).
            </p>
          ) : null}
          <label className="grid gap-2 text-sm font-medium">
            {positions
              ? 'Vault addresses (optional, separated by commas or newlines)'
              : rewards
                ? 'Vault address (required)'
                : 'Vault address (optional)'}
            <textarea
              value={vault}
              onChange={(event) => setVault(event.target.value)}
              placeholder={
                positions
                  ? 'Leave empty for all vaults'
                  : rewards
                    ? '0x…'
                    : 'Leave empty for all vaults'
              }
              required={rewards}
              rows={positions ? 3 : 2}
              spellCheck={false}
              autoCapitalize="none"
              aria-invalid={vault !== '' && !validVault}
              className="min-w-0 w-full rounded-md border border-fd-border bg-fd-background px-3 py-2 font-mono text-xs"
            />
          </label>
          {vault !== '' && !validVault ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              {positions
                ? 'Enter full Sui vault addresses separated by commas or whitespace.'
                : 'Enter one full Sui vault address.'}
            </p>
          ) : null}
          {positions ? (
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
                Filters apply client-side. Selecting no strategy providers while filtering returns
                an empty list.
              </p>
            </div>
          ) : null}
          <button
            type="submit"
            disabled={!valid}
            className="rounded-md bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Loading…' : `Run ${method}`}
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
            ? 'Fetching results…'
            : error
              ? 'Request failed.'
              : result
                ? `${result.rows.length} results · ${result.elapsed} ms${result.code !== code ? ' · Parameters changed. Run again to update these results.' : ''}`
                : `Run ${method} to see results here.`}
        </div>
        {error ? (
          <p role="alert" className="px-5 pb-5 text-sm text-red-600 dark:text-red-400">
            {error} Check the addresses and connection, then try again.
          </p>
        ) : null}
        {result?.rows.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-fd-muted-foreground">
            No {rewards ? 'reward entries' : positions ? 'positions' : 'pending requests'} found for
            these parameters.
          </p>
        ) : null}
        {result && result.rows.length > 0 ? (
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Results of the last {method} request</caption>
              <thead className="sticky top-0 bg-fd-muted">
                <tr>
                  {columns[method].map((column) => (
                    <th
                      key={column}
                      scope="col"
                      className="whitespace-nowrap px-4 py-3 text-xs font-medium"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, index) => (
                  <tr key={index} className="border-t border-fd-border">
                    {row.map((cell, column) => (
                      <td key={columns[method][column]} className="px-4 py-3">
                        <span className="block min-w-32 max-w-64 break-all text-xs tabular-nums">
                          {cell}
                        </span>
                      </td>
                    ))}
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
              <code>{result.json}</code>
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  )
}
