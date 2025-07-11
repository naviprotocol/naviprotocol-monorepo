/**
 * Lending Configuration Management
 *
 * This module provides configuration management for the lending protocol.
 * It handles fetching configuration from the Navi protocol API and provides
 * caching mechanisms for efficient configuration retrieval.
 *
 * @module LendingConfig
 */

import type { LendingConfig, EnvOption, CacheOption } from './types'
import { withCache, withSingleton } from './utils'

/**
 * Fetches lending protocol configuration from the API
 *
 * This function retrieves the current configuration for the lending protocol
 * from the Navi protocol API. It's wrapped with both caching and singleton
 * behavior to ensure efficient and consistent configuration access.
 *
 * The configuration includes:
 * - Contract addresses for all protocol components
 * - Oracle configuration and price feed information
 * - Pool and incentive contract addresses
 * - Environment-specific settings
 *
 * @param options - Optional environment and caching options
 * @returns Promise<LendingConfig> - Complete lending protocol configuration
 */
export const getConfig = withCache(
  withSingleton(async (options?: Partial<EnvOption & CacheOption>): Promise<LendingConfig> => {
    // Build API URL with environment parameter
    const url = `https://open-api.naviprotocol.io/api/navi/config?env=${options?.env || 'prod'}`

    // Fetch configuration from API
    const res = await fetch(url).then((res) => res.json())
    return res.data
  })
)

/**
 * Default cache time for configuration data
 *
 * Configuration is cached for 5 minutes to reduce API calls
 * while ensuring reasonably fresh configuration data.
 */
export const DEFAULT_CACHE_TIME = 1000 * 60 * 5
