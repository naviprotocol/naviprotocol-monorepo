;(() => {
  if ((globalThis.fetch as any).isWraped) {
    return
  }
  const _fetch = fetch
  const shouldUseNaviHeaders = (input: RequestInfo | URL) => {
    let url: URL
    try {
      url =
        input instanceof URL
          ? input
          : typeof input === 'string'
            ? new URL(input)
            : new URL(input.url)
    } catch {
      return false
    }

    return url.hostname.endsWith('naviprotocol.io')
  }

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!shouldUseNaviHeaders(input)) {
      return _fetch(input, init)
    }

    return _fetch(input, {
      ...init,
      headers: {
        ...init?.headers,
        Host: 'app.naviprotocol.io',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
        Referer: 'https://app.naviprotocol.io/',
        origin: 'app.naviprotocol.io'
      }
    })
  }
  ;(globalThis.fetch as any).isWraped = true
})()
