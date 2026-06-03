import packageJson from '../package.json'

const sdkVersion = packageJson.version

const getNodeInfo = (): string => {
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    const nodeVersion: string = process.version
    const formattedNodeVersion: string = nodeVersion.startsWith('v')
      ? nodeVersion.substring(1)
      : nodeVersion

    return `Node.js ${formattedNodeVersion}`
  }
  return 'Node/Unknown'
}

export const getUserAgent = (): string => {
  let environmentInfo: string = ''

  const isNode = typeof process !== 'undefined' && process.versions && process.versions.node

  if (isNode) {
    environmentInfo = `lending/${sdkVersion} (${getNodeInfo()})`
  }

  return environmentInfo
}

export const userAgent = getUserAgent()
