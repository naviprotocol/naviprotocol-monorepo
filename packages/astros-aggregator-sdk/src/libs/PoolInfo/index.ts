/**
 * Retrieves the latest protocol package ID from the Navi Protocol API.
 * @returns The latest protocol package ID.
 */
export async function getLatestProtocolPackageId() {
  const apiUrl = 'https://open-api.naviprotocol.io/api/package'

  try {
    const response = await fetch(apiUrl)
    if (!response.ok) {
      throw new Error(`API call failed with status ${response.status}`)
    }

    const data = await response.json()
    return data.packageId
  } catch (error) {
    console.error('Failed to update ProtocolPackage:')
    return ''
  }
}
