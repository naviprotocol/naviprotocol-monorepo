import { DcaOptions } from './types'
import { getDcaConfig } from './getDcaConfig'

/**
 * Gets the DCA package ID
 * Priority: options.dcaContract > default config
 *
 * @param options - Optional DCA configuration overrides
 * @returns DCA package ID
 */
export function getDcaPackageId(options?: DcaOptions): string {
  const config = getDcaConfig(options)
  return config.dcaContract
}
