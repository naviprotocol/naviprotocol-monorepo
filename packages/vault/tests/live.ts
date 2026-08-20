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

export function isTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return TRANSPORT_ERROR.test(message)
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
