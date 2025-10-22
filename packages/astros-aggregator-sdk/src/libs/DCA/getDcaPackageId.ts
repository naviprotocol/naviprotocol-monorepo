import { AggregatorConfig } from '../Aggregator/config'

export function getDcaPackageId() {
  if (process.env.NEXT_PUBLIC_DCA_PACKAGE_ID) {
    return process.env.NEXT_PUBLIC_DCA_PACKAGE_ID
  }
  return AggregatorConfig.dcaContract
}
