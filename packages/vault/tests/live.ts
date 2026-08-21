/**
 * Helpers for tests that reach third-party endpoints.
 *
 * NAVI's open-api and the Astros aggregator both drop connections occasionally. A
 * transient outage there says nothing about this package, so these retry and then skip —
 * loudly — rather than failing the suite. Any error that is not transport-shaped still
 * fails, so a real regression is never swallowed.
 */
const TRANSPORT_ERROR =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket disconnected|socket hang up|fetch failed|network|No swap route/i

/**
 * Walks the cause chain, not just the top message: everything that reaches the API is
 * wrapped in a `VaultSdkError`, so the transport signature only ever appears on a cause.
 */
export function isTransportError(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 8; depth += 1) {
    const message = current instanceof Error ? current.message : String(current)
    if (TRANSPORT_ERROR.test(message)) return true
    current = current instanceof Error ? current.cause : undefined
  }
  return false
}

/**
 * Runs `build`, retrying transport failures. Returns `undefined` when the endpoint stayed
 * unreachable, which callers treat as "skip this assertion".
 */
export async function buildOrSkip<T>(
  label: string,
  build: () => Promise<T>,
  attempts = 4
): Promise<T | undefined> {
  let last: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await build()
    } catch (error) {
      if (!isTransportError(error)) throw error
      last = error
    }
  }
  console.warn(
    `skipped ${label}: endpoint unreachable after ${attempts} attempts — ` +
      `${(last as Error)?.message?.slice(0, 120)}`
  )
  return undefined
}
