import axios from 'axios'

axios.interceptors.request.use((config) => {
  config.headers.set('Host', 'app.naviprotocol.io')
  config.headers.set(
    'User-Agent',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
  )
  config.headers.set('Referer', 'https://app.naviprotocol.io/')
  config.headers.set('origin', 'app.naviprotocol.io')
  return config
})

axios.interceptors.response.use((response) => {
  console.log('response', response)
  return response
})
;(() => {
  if ((globalThis.fetch as any).isWraped) {
    return
  }
  const _fetch = fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
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
