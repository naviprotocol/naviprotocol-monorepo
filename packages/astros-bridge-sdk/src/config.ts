/**
 * Bridge SDK Configuration Management
 *
 * This module provides configuration management for the Astros bridge SDK.
 * It handles base URL and API key management for cross-chain bridge API requests,
 * and provides a configured Axios instance for HTTP requests.
 *
 * @module BridgeConfig
 */

import axios from 'axios'

/**
 * Configuration object for the bridge SDK
 *
 * Contains the base URL for the bridge API and the API key for authentication.
 */
export const BridgeConfig = {
  /** Base URL for the bridge API */
  baseUrl: 'https://open-aggregator-api.naviprotocol.io',
  /** API key for authentication (optional) */
  apiKey: ''
}

/**
 * Axios instance configured for bridge API requests
 *
 * This instance is pre-configured with the base URL and timeout settings.
 */
export const apiInstance = axios.create({
  baseURL: BridgeConfig.baseUrl,
  timeout: 30000
})

/**
 * Updates the bridge SDK configuration
 *
 * This function allows runtime updates to the configuration object,
 * including the base URL and API key. It also updates the Axios instance
 * to use the new configuration values.
 *
 * @param newConfig - Partial configuration object with new values to merge
 */
export function config(newConfig: Partial<typeof BridgeConfig>) {
  Object.assign(BridgeConfig, newConfig)
  apiInstance.defaults.baseURL = BridgeConfig.baseUrl
  if (BridgeConfig.apiKey) {
    apiInstance.defaults.headers.common['x-navi-token'] = BridgeConfig.apiKey
  } else {
    delete apiInstance.defaults.headers.common['x-navi-token']
  }
}
