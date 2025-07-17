;(() => {
  if ((globalThis.fetch as any).isWraped) {
    return
  }
  const _fetch = fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    console.log('fetch', input)
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
