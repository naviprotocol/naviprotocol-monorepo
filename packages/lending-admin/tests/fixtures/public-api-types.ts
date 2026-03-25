import type { AdminPTBOptions, PTBObjectArgument, ReserveSelector } from '../../src'

type PublicApiTypeSmoke = {
  options: AdminPTBOptions
  objectArgument: PTBObjectArgument
  selector: ReserveSelector
}

const selector: PublicApiTypeSmoke['selector'] = { assetId: 0 }

export type { PublicApiTypeSmoke }
export { selector }
