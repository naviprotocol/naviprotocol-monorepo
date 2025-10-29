/**
 * Get DCA Configuration
 *
 * Merges default production config with optional overrides (for testing)
 */

import { AggregatorConfig } from '../Aggregator'
import { DcaOptions } from './types'

/**
 * Merged DCA configuration
 */
export type DcaConfig = {
  dcaContract: string
  dcaGlobalConfig: string
  dcaRegistry: string
}

/**
 * Gets the DCA configuration, merging defaults with optional overrides
 *
 * @param options - Optional DCA configuration overrides (e.g., for testing)
 * @returns Merged DCA configuration
 *
 * @example
 * ```typescript
 * // Use default production config
 * const config = getDcaConfig()
 *
 * // Override for testing
 * const testConfig = getDcaConfig({
 *   dcaContract: '0xTEST_PACKAGE_ID',
 *   dcaGlobalConfig: '0xTEST_GLOBAL_CONFIG',
 *   dcaRegistry: '0xTEST_REGISTRY'
 * })
 * ```
 */
export function getDcaConfig(options?: DcaOptions): DcaConfig {
  return {
    dcaContract: options?.dcaContract ?? AggregatorConfig.dcaContract,
    dcaGlobalConfig: options?.dcaGlobalConfig ?? AggregatorConfig.dcaGlobalConfig,
    dcaRegistry: options?.dcaRegistry ?? AggregatorConfig.dcaRegistry
  }
}
