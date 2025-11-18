import packageJson from '../package.json'

const sdkVersion = packageJson.version

const getNodeInfo = (): string => {
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const os = require('os')
      const nodeVersion: string = process.version
      const osType: string = os.type()
      const osArch: string = os.arch()

      const formattedNodeVersion: string = nodeVersion.startsWith('v')
        ? nodeVersion.substring(1)
        : nodeVersion

      return `Node.js ${formattedNodeVersion}; ${osType}/${osArch}`
    } catch (e) {
      return `Node.js ${process.version}; OS/Unknown (Error)`
    }
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
